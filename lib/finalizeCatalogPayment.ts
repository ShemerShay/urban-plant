/**
 * Finalize one verified Catalog payment.
 * Prices, line identity, and plant unit cost come from the stored attempt snapshot.
 * Order, items, inventory, history, hold consumption, and attempt status commit together.
 * A verified payment whose holds are no longer safe to fulfill is marked
 * needs_reconciliation and does not sell stock.
 */

import "server-only";

import { sql } from "@/lib/db";
import { getPaymentAttemptById } from "@/lib/paymentAttemptStorage";

const RECONCILE_REASON = "catalog_holds_unsafe";

export type FinalizeCatalogVerifiedPaymentResult =
  | { outcome: "finalized"; orderId: string; attemptId: string }
  | { outcome: "already_finalized"; orderId: string; attemptId: string }
  | {
      outcome: "needs_reconciliation";
      attemptId: string;
      /** True only when this call performed the status transition. */
      firstTransition: boolean;
    }
  | { outcome: "ineligible" };

type WriteRow = {
  order_id: string | null;
  recon_id: string | null;
  finalized_attempt_id: string | null;
};

function pgCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

function isUnsafeFulfillmentError(error: unknown): boolean {
  const message = errorMessage(error);
  if (pgCode(error) === "22012" || /division by zero/i.test(message)) return true;
  return /inventory_quantity_non_negative|pot_inventory_quantity_non_negative/i.test(message);
}

async function markCatalogNeedsReconciliation(input: {
  attemptId: string;
  checkoutSessionId: string;
  cardcomTransactionId: number | null;
}): Promise<boolean> {
  const rows = await sql`
    UPDATE payment_attempts
    SET
      status = 'needs_reconciliation',
      failure_reason = ${RECONCILE_REASON},
      cardcom_transaction_id = COALESCE(
        ${input.cardcomTransactionId}::bigint,
        cardcom_transaction_id
      ),
      payment_retry_lock_at = NULL,
      updated_at = now()
    WHERE id = ${input.attemptId}::uuid
      AND channel = 'catalog'
      AND checkout_session_id = ${input.checkoutSessionId}
      AND status = 'awaiting_payment'
    RETURNING id
  `;
  return (rows as unknown[]).length > 0;
}

async function readTerminalOutcome(
  attemptId: string,
): Promise<FinalizeCatalogVerifiedPaymentResult> {
  const current = await getPaymentAttemptById(attemptId);
  if (!current) return { outcome: "ineligible" };
  if (current.status === "finalized" && current.finalizedOrderId) {
    return {
      outcome: "already_finalized",
      orderId: current.finalizedOrderId,
      attemptId: current.id,
    };
  }
  if (current.status === "needs_reconciliation") {
    return {
      outcome: "needs_reconciliation",
      attemptId: current.id,
      firstTransition: false,
    };
  }
  return { outcome: "ineligible" };
}

/**
 * One Neon transaction: lock the attempt, its holds, and the plant variants,
 * then either sell the stored snapshot or mark the attempt for reconciliation.
 */
export async function finalizeCatalogVerifiedPayment(input: {
  attemptId: string;
  checkoutSessionId: string;
  cardcomTransactionId?: number;
}): Promise<FinalizeCatalogVerifiedPaymentResult> {
  const attemptId = input.attemptId.trim();
  const checkoutSessionId = input.checkoutSessionId.trim();
  if (!attemptId || !checkoutSessionId) return { outcome: "ineligible" };
  const cardcomTransactionId =
    typeof input.cardcomTransactionId === "number" &&
    Number.isFinite(input.cardcomTransactionId)
      ? Math.trunc(input.cardcomTransactionId)
      : null;

  const resourceRows = await sql`
    SELECT DISTINCT
      NULLIF(line->>'plantVariantId', '') AS plant_variant_id,
      NULLIF(line->>'potColorId', '') AS pot_color_id
    FROM payment_attempts a
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(a.catalog_snapshot->'lines', '[]'::jsonb)
    ) AS line
    WHERE a.id = ${attemptId}::uuid
      AND a.channel = 'catalog'
  `;
  const variantIds = [
    ...new Set(
      (resourceRows as { plant_variant_id: string | null }[])
        .map((row) => row.plant_variant_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ].sort();
  const colorIds = [
    ...new Set(
      (resourceRows as { pot_color_id: string | null }[])
        .map((row) => row.pot_color_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ].sort();

  const lockQueries = [...variantIds, ...colorIds].map(
    (resourceId) => sql`
      SELECT pg_advisory_xact_lock(
        hashtext('catalog_stock_hold'),
        hashtext(${resourceId}::text)
      )
    `,
  );
  const inventoryLock =
    variantIds.length > 0
      ? sql`
          SELECT variant_id
          FROM inventory
          WHERE variant_id = ANY(${variantIds}::uuid[])
          ORDER BY variant_id
          FOR UPDATE
        `
      : sql`SELECT 1 WHERE false`;
  const potInventoryLock =
    colorIds.length > 0
      ? sql`
          SELECT pot_color_id
          FROM pot_inventory
          WHERE pot_color_id = ANY(${colorIds}::uuid[])
          ORDER BY pot_color_id
          FOR UPDATE
        `
      : sql`SELECT 1 WHERE false`;

  let row: WriteRow | undefined;
  try {
    const results = await sql.transaction([
      sql`
        SELECT id
        FROM payment_attempts
        WHERE id = ${attemptId}::uuid
          AND channel = 'catalog'
          AND checkout_session_id = ${checkoutSessionId}
        FOR UPDATE
      `,
      sql`
        SELECT id
        FROM catalog_stock_holds
        WHERE attempt_id = ${attemptId}::uuid
        ORDER BY id
        FOR UPDATE
      `,
      ...lockQueries,
      inventoryLock,
      potInventoryLock,
      sql`
        WITH locked AS (
          SELECT
            a.id,
            a.catalog_snapshot,
            a.checkout_session_id,
            a.cardcom_env,
            a.payment_resume_token,
            a.product_id,
            a.product_name,
            a.full_name,
            a.customer_email,
            a.phone,
            a.address,
            a.apartment_or_notes,
            a.amount
          FROM payment_attempts a
          WHERE a.id = ${attemptId}::uuid
            AND a.channel = 'catalog'
            AND a.status = 'awaiting_payment'
            AND a.checkout_session_id = ${checkoutSessionId}
            AND a.pos_spot_id IS NULL
          FOR UPDATE
        ),
        lines AS (
          SELECT
            (line->>'lineNo')::int AS line_no,
            line->>'plantId' AS plant_id,
            (line->>'plantVariantId')::uuid AS plant_variant_id,
            (line->>'sellableVariantId')::uuid AS sellable_variant_id,
            line->>'offerId' AS offer_id,
            NULLIF(line->>'potSizeId', '')::uuid AS pot_size_id,
            NULLIF(line->>'potColorId', '')::uuid AS pot_color_id,
            (line->>'quantity')::int AS quantity,
            (line->>'unitPrice')::numeric AS unit_price,
            (line->>'lineTotal')::numeric AS line_total,
            line->>'currency' AS currency,
            line->>'plantName' AS plant_name,
            NULLIF(line->>'plantNameHe', '') AS plant_name_he,
            NULLIF(line->>'sizeLabel', '') AS size_label,
            NULLIF(line->>'potName', '') AS pot_name,
            NULLIF(line->>'potSizeLabel', '') AS pot_size_label,
            NULLIF(line->>'potColor', '') AS pot_color,
            NULLIF(line->>'potColorHe', '') AS pot_color_he,
            CASE
              WHEN line->>'plantUnitCost' IS NULL THEN NULL
              ELSE (line->>'plantUnitCost')::numeric
            END AS plant_unit_cost,
            NULLIF(line->>'plantUnitCostSource', '') AS plant_unit_cost_source,
            CASE
              WHEN line->>'potUnitCost' IS NULL THEN NULL
              ELSE (line->>'potUnitCost')::numeric
            END AS pot_unit_cost,
            NULLIF(line->>'potUnitCostSource', '') AS pot_unit_cost_source
          FROM locked l
          CROSS JOIN LATERAL jsonb_array_elements(l.catalog_snapshot->'lines') AS line
        ),
        plant_agg AS (
          SELECT plant_variant_id, SUM(quantity)::int AS quantity
          FROM lines
          GROUP BY plant_variant_id
        ),
        color_agg AS (
          SELECT pot_color_id, SUM(quantity)::int AS quantity
          FROM lines
          WHERE pot_color_id IS NOT NULL
          GROUP BY pot_color_id
        ),
        hold_match AS (
          SELECT
            (SELECT COUNT(*)::int FROM plant_agg) + (SELECT COUNT(*)::int FROM color_agg) AS resource_count,
            (
              SELECT COUNT(*)::int
              FROM catalog_stock_holds h
              WHERE h.attempt_id = ${attemptId}::uuid
            ) AS hold_count,
            (
              SELECT COUNT(*)::int
              FROM catalog_stock_holds h
              INNER JOIN plant_agg a ON a.plant_variant_id = h.plant_variant_id
              WHERE h.attempt_id = ${attemptId}::uuid
                AND h.status = 'active'
                AND h.expires_at > now()
                AND h.quantity = a.quantity
                AND h.pot_color_id IS NULL
            ) + (
              SELECT COUNT(*)::int
              FROM catalog_stock_holds h
              INNER JOIN color_agg c ON c.pot_color_id = h.pot_color_id
              WHERE h.attempt_id = ${attemptId}::uuid
                AND h.status = 'active'
                AND h.expires_at > now()
                AND h.quantity = c.quantity
                AND h.plant_variant_id IS NULL
            ) AS matched_count
        ),
        safe AS (
          SELECT (
            EXISTS (SELECT 1 FROM locked)
            AND (SELECT COUNT(*) FROM lines) > 0
            AND (SELECT resource_count FROM hold_match) > 0
            AND (SELECT resource_count FROM hold_match) = (SELECT hold_count FROM hold_match)
            AND (SELECT resource_count FROM hold_match) = (SELECT matched_count FROM hold_match)
            AND COALESCE((
              SELECT bool_and(COALESCE(i.quantity, 0) >= a.quantity)
              FROM plant_agg a
              LEFT JOIN inventory i ON i.variant_id = a.plant_variant_id
            ), false)
            AND COALESCE((
              SELECT bool_and(COALESCE(pi.quantity, 0) >= c.quantity)
              FROM color_agg c
              LEFT JOIN pot_inventory pi ON pi.pot_color_id = c.pot_color_id
            ), true)
          ) AS ok
        ),
        recon AS (
          UPDATE payment_attempts a
          SET
            status = 'needs_reconciliation',
            failure_reason = ${RECONCILE_REASON},
            cardcom_transaction_id = COALESCE(
              ${cardcomTransactionId}::bigint,
              a.cardcom_transaction_id
            ),
            payment_retry_lock_at = NULL,
            updated_at = now()
          WHERE a.id = (SELECT id FROM locked)
            AND a.status = 'awaiting_payment'
            AND NOT (SELECT ok FROM safe)
          RETURNING a.id
        ),
        order_ins AS (
          INSERT INTO orders (
            order_id,
            checkout_session_id,
            cardcom_env,
            payment_resume_token,
            pos_spot_id,
            offer_id,
            product_id,
            product_name,
            partner_location_id,
            partner_location_name,
            partner_location_address,
            price,
            full_name,
            customer_email,
            phone,
            address,
            apartment_or_notes,
            fulfillment_method,
            order_status,
            source,
            channel,
            partner_id,
            commission_rate,
            picked_up_at,
            snapshot,
            created_at,
            cardcom_transaction_id,
            purchase_email_status
          )
          SELECT
            gen_random_uuid(),
            l.checkout_session_id,
            l.cardcom_env,
            l.payment_resume_token,
            NULL::uuid,
            NULL,
            l.product_id,
            l.product_name,
            NULL,
            NULL,
            NULL,
            l.amount,
            l.full_name,
            NULLIF(l.customer_email, ''),
            l.phone,
            l.address,
            l.apartment_or_notes,
            'delivery',
            'sold',
            'online',
            'catalog',
            NULL,
            NULL,
            NULL::timestamptz,
            NULL::jsonb,
            now(),
            ${cardcomTransactionId}::bigint,
            'pending'
          FROM locked l
          WHERE (SELECT ok FROM safe)
            AND NOT EXISTS (SELECT 1 FROM recon)
          RETURNING order_id
        ),
        item_ins AS (
          INSERT INTO order_items (
            order_id,
            line_no,
            plant_id,
            plant_variant_id,
            sellable_variant_id,
            offer_id,
            pot_size_id,
            pot_color_id,
            quantity,
            unit_price,
            line_total,
            currency,
            plant_name,
            plant_name_he,
            size_label,
            pot_name,
            pot_size_label,
            pot_color,
            pot_color_he,
            plant_unit_cost,
            plant_unit_cost_source,
            pot_unit_cost,
            pot_unit_cost_source
          )
          SELECT
            o.order_id,
            ln.line_no,
            ln.plant_id,
            ln.plant_variant_id,
            ln.sellable_variant_id,
            ln.offer_id,
            ln.pot_size_id,
            ln.pot_color_id,
            ln.quantity,
            ln.unit_price,
            ln.line_total,
            ln.currency,
            ln.plant_name,
            ln.plant_name_he,
            ln.size_label,
            ln.pot_name,
            ln.pot_size_label,
            ln.pot_color,
            ln.pot_color_he,
            ln.plant_unit_cost,
            ln.plant_unit_cost_source,
            ln.pot_unit_cost,
            ln.pot_unit_cost_source
          FROM order_ins o
          CROSS JOIN lines ln
          RETURNING id
        ),
        inv_upd AS (
          UPDATE inventory i
          SET
            quantity = i.quantity - a.quantity,
            updated_at = now()
          FROM plant_agg a
          WHERE i.variant_id = a.plant_variant_id
            AND i.quantity >= a.quantity
            AND EXISTS (SELECT 1 FROM order_ins)
          RETURNING i.variant_id, a.quantity AS qty
        ),
        hist AS (
          INSERT INTO inventory_history (variant_id, delta, note)
          SELECT u.variant_id, -u.qty, 'catalog sale ' || o.order_id::text
          FROM inv_upd u
          CROSS JOIN order_ins o
          RETURNING id
        ),
        pot_upd AS (
          UPDATE pot_inventory pi
          SET
            quantity = pi.quantity - c.quantity,
            updated_at = now()
          FROM color_agg c
          WHERE pi.pot_color_id = c.pot_color_id
            AND pi.quantity >= c.quantity
            AND EXISTS (SELECT 1 FROM order_ins)
          RETURNING pi.pot_color_id, c.quantity AS qty
        ),
        pot_hist AS (
          INSERT INTO pot_inventory_history (pot_color_id, delta, note)
          SELECT u.pot_color_id, -u.qty, 'catalog sale ' || o.order_id::text
          FROM pot_upd u
          CROSS JOIN order_ins o
          RETURNING id
        ),
        consumed AS (
          UPDATE catalog_stock_holds h
          SET status = 'consumed', updated_at = now()
          WHERE h.attempt_id = ${attemptId}::uuid
            AND h.status = 'active'
            AND h.expires_at > now()
            AND EXISTS (SELECT 1 FROM order_ins)
            AND (
              EXISTS (
                SELECT 1
                FROM plant_agg a
                WHERE a.plant_variant_id = h.plant_variant_id
                  AND a.quantity = h.quantity
                  AND h.pot_color_id IS NULL
              )
              OR EXISTS (
                SELECT 1
                FROM color_agg c
                WHERE c.pot_color_id = h.pot_color_id
                  AND c.quantity = h.quantity
                  AND h.plant_variant_id IS NULL
              )
            )
          RETURNING h.id
        ),
        attempt_fin AS (
          UPDATE payment_attempts a
          SET
            status = 'finalized',
            finalized_order_id = o.order_id,
            cardcom_transaction_id = COALESCE(
              ${cardcomTransactionId}::bigint,
              a.cardcom_transaction_id
            ),
            payment_retry_lock_at = NULL,
            failure_reason = NULL,
            updated_at = now()
          FROM order_ins o
          WHERE a.id = ${attemptId}::uuid
            AND a.status = 'awaiting_payment'
          RETURNING a.id
        ),
        guard AS (
          SELECT 1 / CASE
            WHEN NOT EXISTS (SELECT 1 FROM locked) THEN 1
            WHEN EXISTS (SELECT 1 FROM recon)
              AND NOT EXISTS (SELECT 1 FROM order_ins)
              AND NOT EXISTS (SELECT 1 FROM inv_upd)
              AND NOT EXISTS (SELECT 1 FROM hist)
              AND NOT EXISTS (SELECT 1 FROM pot_upd)
              AND NOT EXISTS (SELECT 1 FROM pot_hist)
              AND NOT EXISTS (SELECT 1 FROM consumed)
              AND NOT EXISTS (SELECT 1 FROM attempt_fin)
            THEN 1
            WHEN EXISTS (SELECT 1 FROM attempt_fin)
              AND (SELECT COUNT(*) FROM order_ins) = 1
              AND (SELECT COUNT(*) FROM item_ins) = (SELECT COUNT(*) FROM lines)
              AND (SELECT COUNT(*) FROM inv_upd) = (SELECT COUNT(*) FROM plant_agg)
              AND (SELECT COUNT(*) FROM hist) = (SELECT COUNT(*) FROM plant_agg)
              AND (SELECT COUNT(*) FROM pot_upd) = (SELECT COUNT(*) FROM color_agg)
              AND (SELECT COUNT(*) FROM pot_hist) = (SELECT COUNT(*) FROM color_agg)
              AND (SELECT COUNT(*) FROM consumed) =
                (SELECT COUNT(*) FROM plant_agg) + (SELECT COUNT(*) FROM color_agg)
            THEN 1
            ELSE 0
          END AS ok
        )
        SELECT
          (SELECT order_id FROM order_ins LIMIT 1) AS order_id,
          (SELECT id FROM recon LIMIT 1) AS recon_id,
          (SELECT id FROM attempt_fin LIMIT 1) AS finalized_attempt_id,
          (SELECT ok FROM guard) AS guard_ok
      `,
    ]);
    const written = results[results.length - 1] as WriteRow[];
    row = written[0];
  } catch (error) {
    if (!isUnsafeFulfillmentError(error)) throw error;
    const claimed = await markCatalogNeedsReconciliation({
      attemptId,
      checkoutSessionId,
      cardcomTransactionId,
    });
    const terminal = await readTerminalOutcome(attemptId);
    if (terminal.outcome === "needs_reconciliation") {
      return { ...terminal, firstTransition: claimed };
    }
    return terminal;
  }

  if (row?.finalized_attempt_id && row.order_id) {
    return { outcome: "finalized", orderId: String(row.order_id), attemptId };
  }
  if (row?.recon_id) {
    return { outcome: "needs_reconciliation", attemptId, firstTransition: true };
  }
  return readTerminalOutcome(attemptId);
}
