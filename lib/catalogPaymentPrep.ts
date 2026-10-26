/**
 * Catalog payment preparation and Cardcom retry.
 * Delivery only. Server prices and supplier cost are snapshotted onto the attempt.
 * Attempt insert and plant-variant holds commit together, or not at all.
 * Retry reuses that attempt and those holds.
 */

import "server-only";

import { randomUUID } from "crypto";

import {
  CardcomError,
  createCardcomLowProfile,
  type CardcomEnvironment,
  type CardcomLowProfileCreateResponse,
  type CreateCardcomLowProfileInput,
} from "@/lib/cardcom";
import { CATALOG_CART_MAX_ITEMS } from "@/lib/catalogCart";
import { expireStaleCatalogStockHolds } from "@/lib/catalogStockHolds";
import { getCheckoutCustomerServerError } from "@/lib/checkoutValidation";
import { sql } from "@/lib/db";
import { resolveDeliveryAddressFromRequest } from "@/lib/deliveryAddress";
import { cardcomLineItemName } from "@/lib/inventoryType";
import {
  attachCheckoutSessionIdToAttempt,
  claimPaymentAttemptRetryLock,
  getAwaitingPaymentAttemptForResume,
  getPaymentAttemptById,
  releasePaymentAttemptRetryLock,
  rotateCheckoutSessionIdForAttemptResume,
} from "@/lib/paymentAttemptStorage";
import type { SavedPaymentAttempt } from "@/lib/paymentAttemptTypes";
import { PAYMENT_HOLD_TTL_MS } from "@/lib/paymentHoldExpiry";
import { createPaymentResumeToken } from "@/lib/paymentResume";
import {
  CANCEL_REASON_CARDCOM_CREATE_FAILED,
  CANCEL_REASON_CARDCOM_RESPONSE_INVALID,
  CANCEL_REASON_CARDCOM_SESSION_ATTACH_FAILED,
  CANCEL_REASON_PAYMENT_PREP_FAILED,
} from "@/lib/startCardcomPaymentPrep";
import { absoluteAppUrl, getPublicAppOrigin, routes } from "@/lib/routes";
import type { RetryCardcomPaymentResult } from "@/lib/retryCardcomPayment";

const CARDCOM_PRODUCT_NAME_MAX_LENGTH = 50;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CatalogCheckoutLineInput = {
  plantId: string;
  plantSizeId: string;
  sellableVariantId: string;
  offerId: string;
  potColorId: string | null;
  quantity: number;
  unitPrice: number;
};

export type StartCatalogCardcomPaymentInput = {
  lines: CatalogCheckoutLineInput[];
  fullName: string;
  phone: string;
  emailOptIn: boolean;
  customerEmail?: string;
  deliveryStreet?: string;
  deliveryHouseNumber?: string;
  apartmentOrNotes?: string;
  address?: string;
};

export type StartCatalogCardcomPaymentDeps = {
  createLowProfile?: (
    input: CreateCardcomLowProfileInput,
  ) => Promise<CardcomLowProfileCreateResponse>;
  publicOrigin?: string;
  cardcomEnvironment?: CardcomEnvironment;
};

export type StartCatalogCardcomPaymentResult =
  | {
      ok: true;
      orderId: string;
      attemptId: string;
      lowProfileId: string;
      paymentUrl: string;
    }
  | {
      ok: false;
      code:
        | "validation"
        | "cart_changed"
        | "insufficient_stock"
        | "config"
        | "cardcom_error"
        | "server_error";
      error: string;
      httpStatus: number;
    };

type CreateRow = {
  cart_changed: boolean;
  insufficient: boolean;
  attempt_id: string | null;
  hold_count: number | string;
  resource_count: number | string;
};

function pgCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function validationFailure(error: string): StartCatalogCardcomPaymentResult {
  return { ok: false, code: "validation", error, httpStatus: 400 };
}

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function isPositiveMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function parseLines(lines: unknown): CatalogCheckoutLineInput[] | null {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > CATALOG_CART_MAX_ITEMS) {
    return null;
  }
  const parsed: CatalogCheckoutLineInput[] = [];
  for (const raw of lines) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const plantId = typeof row.plantId === "string" ? row.plantId.trim() : "";
    const plantSizeId =
      typeof row.plantSizeId === "string" ? row.plantSizeId.trim().toLowerCase() : "";
    const sellableVariantId =
      typeof row.sellableVariantId === "string" ? row.sellableVariantId.trim().toLowerCase() : "";
    const offerId = typeof row.offerId === "string" ? row.offerId.trim() : "";
    if (!plantId || !isUuid(plantSizeId) || !isUuid(sellableVariantId) || !offerId) return null;

    let potColorId: string | null = null;
    if (row.potColorId == null) {
      potColorId = null;
    } else if (typeof row.potColorId === "string") {
      const trimmed = row.potColorId.trim().toLowerCase();
      if (!trimmed) potColorId = null;
      else if (!isUuid(trimmed)) return null;
      else potColorId = trimmed;
    } else {
      return null;
    }

    if (!Number.isInteger(row.quantity) || (row.quantity as number) <= 0) return null;
    if (!isPositiveMoney(row.unitPrice)) return null;

    parsed.push({
      plantId,
      plantSizeId,
      sellableVariantId,
      offerId,
      potColorId,
      quantity: row.quantity as number,
      unitPrice: row.unitPrice,
    });
  }
  return parsed;
}

function resolvePublicOrigin(injected?: string): string {
  if (injected?.trim()) {
    const parsed = new URL(injected.trim());
    if (parsed.protocol !== "https:") {
      throw new Error("APP_ORIGIN must use HTTPS.");
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local")
    ) {
      throw new Error("APP_ORIGIN must be a public HTTPS origin (not localhost).");
    }
    return parsed.origin;
  }
  return getPublicAppOrigin();
}

function catalogCallbackUrls(
  origin: string,
  attemptId: string,
  resumeToken: string,
): { successRedirectUrl: string; failedRedirectUrl: string; webHookUrl: string } {
  const failedQuery = new URLSearchParams({
    paymentFailed: "1",
    orderId: attemptId,
    resume: resumeToken,
  });
  return {
    successRedirectUrl: absoluteAppUrl(
      origin,
      routes.customer.paymentSuccess({ orderId: attemptId, resume: resumeToken }),
    ),
    failedRedirectUrl: absoluteAppUrl(origin, `/shop?${failedQuery.toString()}`),
    webHookUrl: absoluteAppUrl(origin, routes.api.cardcomWebhook()),
  };
}

function catalogCardcomProductName(attempt: SavedPaymentAttempt): string {
  const raw = attempt.productName.trim();
  if (!raw) throw new Error("Payment attempt is missing product name for Cardcom Create.");
  const named = cardcomLineItemName("plants", raw);
  return named.length > CARDCOM_PRODUCT_NAME_MAX_LENGTH
    ? named.slice(0, CARDCOM_PRODUCT_NAME_MAX_LENGTH)
    : named;
}

function mapCardcomFailure(error: unknown): {
  reason: string;
  code: "config" | "cardcom_error" | "server_error";
  httpStatus: number;
  error: string;
} {
  if (error instanceof CardcomError) {
    if (error.code === "config") {
      return {
        reason: CANCEL_REASON_CARDCOM_CREATE_FAILED,
        code: "config",
        httpStatus: 500,
        error: "Payment is temporarily unavailable. Try again later.",
      };
    }
    return {
      reason:
        error.code === "parse" || error.code === "cardcom"
          ? CANCEL_REASON_CARDCOM_RESPONSE_INVALID
          : CANCEL_REASON_CARDCOM_CREATE_FAILED,
      code: "cardcom_error",
      httpStatus: 502,
      error: "Could not start payment. Try again.",
    };
  }
  return {
    reason: CANCEL_REASON_PAYMENT_PREP_FAILED,
    code: "server_error",
    httpStatus: 500,
    error: "Could not start payment. Try again.",
  };
}

/** Release active holds and cancel the attempt in one statement. */
export async function compensateCatalogPaymentPrep(
  attemptId: string,
  reason: string,
): Promise<void> {
  const id = attemptId.trim();
  const reasonTrim = reason.trim() || CANCEL_REASON_PAYMENT_PREP_FAILED;
  if (!id) return;
  try {
    await sql`
      WITH released AS (
        UPDATE catalog_stock_holds
        SET status = 'released', updated_at = now()
        WHERE attempt_id = ${id}::uuid
          AND status = 'active'
        RETURNING id
      )
      UPDATE payment_attempts
      SET
        status = 'cancelled',
        failure_reason = ${reasonTrim},
        payment_retry_lock_at = NULL,
        updated_at = now()
      WHERE id = ${id}::uuid
        AND channel = 'catalog'
        AND status IN ('created', 'awaiting_payment')
    `;
  } catch (error) {
    console.error("[catalog-payment] compensate failed", {
      attemptId: id,
      reason: reasonTrim,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

async function createCatalogAttemptAndHolds(input: {
  attemptId: string;
  resumeToken: string;
  lines: CatalogCheckoutLineInput[];
  fullName: string;
  customerEmail: string;
  phone: string;
  address: string;
  apartmentOrNotes: string;
}): Promise<
  | { ok: true; attemptId: string }
  | Extract<StartCatalogCardcomPaymentResult, { ok: false }>
> {
  const payload = JSON.stringify(
    input.lines.map((line) => ({
      plantId: line.plantId,
      plantSizeId: line.plantSizeId,
      sellableVariantId: line.sellableVariantId,
      offerId: line.offerId,
      potColorId: line.potColorId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    })),
  );
  const plantIds = [...new Set(input.lines.map((line) => line.plantSizeId))].sort();
  const colorIds = [
    ...new Set(
      input.lines.map((line) => line.potColorId).filter((id): id is string => Boolean(id)),
    ),
  ].sort();
  const expectedHoldCount = plantIds.length + colorIds.length;
  const lockQueries = [...plantIds, ...colorIds].map(
    (resourceId) => sql`
      SELECT pg_advisory_xact_lock(
        hashtext('catalog_stock_hold'),
        hashtext(${resourceId}::text)
      )
    `,
  );

  let rows: CreateRow[];
  try {
    const results = await sql.transaction([
      ...lockQueries,
      sql`
        WITH input_lines AS (
          SELECT
            ord::int AS line_no,
            elem->>'plantId' AS plant_id,
            (elem->>'plantSizeId')::uuid AS plant_variant_id,
            (elem->>'sellableVariantId')::uuid AS sellable_variant_id,
            elem->>'offerId' AS offer_id,
            NULLIF(elem->>'potColorId', '')::uuid AS pot_color_id,
            (elem->>'quantity')::int AS quantity,
            round((elem->>'unitPrice')::numeric, 2) AS client_unit_price
          FROM jsonb_array_elements(${payload}::jsonb) WITH ORDINALITY AS t(elem, ord)
        ),
        matched AS (
          SELECT
            i.line_no,
            i.plant_id,
            i.plant_variant_id,
            i.sellable_variant_id,
            i.offer_id,
            i.pot_color_id,
            i.quantity,
            i.client_unit_price,
            p.id AS server_plant_id,
            p.name AS plant_name,
            NULLIF(btrim(p.name_he), '') AS plant_name_he,
            NULLIF(btrim(pv.size_label), '') AS size_label,
            round(o.consumer_price, 2) AS server_unit_price,
            sv.pot_size_id,
            CASE
              WHEN sv.pot_size_id IS NULL THEN NULL
              ELSE NULLIF(btrim(parent_pot.name), '')
            END AS pot_name,
            CASE
              WHEN sv.pot_size_id IS NULL THEN NULL
              ELSE NULLIF(btrim(parent_pot.name_he), '')
            END AS pot_name_he,
            CASE
              WHEN sv.pot_size_id IS NULL THEN NULL
              ELSE ps.size_label
            END AS pot_size_label,
            CASE
              WHEN sv.pot_size_id IS NULL THEN NULL
              ELSE NULLIF(btrim(pc.color), '')
            END AS pot_color,
            CASE
              WHEN sv.pot_size_id IS NULL THEN NULL
              ELSE NULLIF(btrim(pc.color_he), '')
            END AS pot_color_he,
            CASE
              WHEN p.supplier_price IS NULL THEN NULL
              WHEN p.supplier_price < 0 THEN NULL
              ELSE round(p.supplier_price, 2)
            END AS plant_unit_cost,
            CASE
              WHEN p.supplier_price IS NULL OR p.supplier_price < 0 THEN NULL
              ELSE 'plants.supplier_price@sale'
            END AS plant_unit_cost_source,
            CASE
              WHEN sv.pot_size_id IS NULL OR ps.supplier_price IS NULL OR ps.supplier_price < 0 THEN NULL
              ELSE round(ps.supplier_price, 2)
            END AS pot_unit_cost,
            CASE
              WHEN sv.pot_size_id IS NULL OR ps.supplier_price IS NULL OR ps.supplier_price < 0 THEN NULL
              ELSE 'pot_sizes.supplier_price@sale'
            END AS pot_unit_cost_source,
            (
              p.id IS NOT NULL
              AND p.catalog_published IS TRUE
              AND COALESCE(p.inventory_type, 'plants') = 'plants'
              AND pv.id IS NOT NULL
              AND pv.plant_id = i.plant_id
              AND sv.id IS NOT NULL
              AND sv.plant_variant_id = pv.id
              AND o.id IS NOT NULL
              AND o.id = i.offer_id
              AND o.status = 'active'
              AND o.sellable_variant_id = sv.id
              AND EXISTS (
                SELECT 1
                FROM offer_availabilities oa
                WHERE oa.offer_id = o.id
                  AND oa.scope = 'catalog'
              )
              AND round(o.consumer_price, 2) = i.client_unit_price
              AND p.currency = 'ILS'
              AND i.quantity > 0
              AND (
                (
                  sv.pot_size_id IS NULL
                  AND i.pot_color_id IS NULL
                )
                OR (
                  sv.pot_size_id IS NOT NULL
                  AND pc.id IS NOT NULL
                  AND pc.pot_size_id = sv.pot_size_id
                  AND NULLIF(btrim(parent_pot.name), '') IS NOT NULL
                  AND NULLIF(btrim(pc.color), '') IS NOT NULL
                )
              )
            ) AS line_ok
          FROM input_lines i
          LEFT JOIN plant_variants pv ON pv.id = i.plant_variant_id
          LEFT JOIN plants p ON p.id = pv.plant_id
          LEFT JOIN sellable_variants sv ON sv.id = i.sellable_variant_id
          LEFT JOIN offers o ON o.id = i.offer_id
          LEFT JOIN pot_sizes ps ON ps.id = sv.pot_size_id
          LEFT JOIN pots parent_pot ON parent_pot.id = ps.pot_id
          LEFT JOIN pot_colors pc ON pc.id = i.pot_color_id
        ),
        flags AS (
          SELECT
            NOT COALESCE((SELECT bool_and(line_ok) FROM matched), false) AS cart_changed
        ),
        plant_agg AS (
          SELECT plant_variant_id, SUM(quantity)::int AS quantity
          FROM matched
          WHERE NOT (SELECT cart_changed FROM flags)
          GROUP BY plant_variant_id
        ),
        color_agg AS (
          SELECT pot_color_id, SUM(quantity)::int AS quantity
          FROM matched
          WHERE NOT (SELECT cart_changed FROM flags)
            AND pot_color_id IS NOT NULL
          GROUP BY pot_color_id
        ),
        plant_availability AS (
          SELECT
            a.plant_variant_id,
            a.quantity,
            GREATEST(
              COALESCE(inv.quantity, 0) - COALESCE((
                SELECT SUM(h.quantity)::int
                FROM catalog_stock_holds h
                WHERE h.plant_variant_id = a.plant_variant_id
                  AND h.status = 'active'
                  AND h.expires_at > now()
              ), 0),
              0
            ) AS available_qty
          FROM plant_agg a
          LEFT JOIN inventory inv ON inv.variant_id = a.plant_variant_id
        ),
        color_availability AS (
          SELECT
            a.pot_color_id,
            a.quantity,
            GREATEST(
              COALESCE(pi.quantity, 0) - COALESCE((
                SELECT SUM(h.quantity)::int
                FROM catalog_stock_holds h
                WHERE h.pot_color_id = a.pot_color_id
                  AND h.status = 'active'
                  AND h.expires_at > now()
              ), 0),
              0
            ) AS available_qty
          FROM color_agg a
          LEFT JOIN pot_inventory pi ON pi.pot_color_id = a.pot_color_id
        ),
        decision AS (
          SELECT
            f.cart_changed,
            (
              NOT f.cart_changed
              AND (
                COALESCE((SELECT bool_or(quantity > available_qty) FROM plant_availability), false)
                OR COALESCE((SELECT bool_or(quantity > available_qty) FROM color_availability), false)
              )
            ) AS insufficient
          FROM flags f
        ),
        snapshot AS (
          SELECT jsonb_build_object(
            'sourcePartnerId', NULL,
            'lines', COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'lineNo', m.line_no,
                  'plantId', m.server_plant_id,
                  'plantVariantId', m.plant_variant_id,
                  'sellableVariantId', m.sellable_variant_id,
                  'offerId', m.offer_id,
                  'potSizeId', m.pot_size_id,
                  'potColorId', m.pot_color_id,
                  'quantity', m.quantity,
                  'unitPrice', m.server_unit_price,
                  'lineTotal', m.server_unit_price * m.quantity,
                  'currency', 'ILS',
                  'plantName', m.plant_name,
                  'plantNameHe', m.plant_name_he,
                  'sizeLabel', m.size_label,
                  'potName', m.pot_name,
                  'potSizeLabel', m.pot_size_label,
                  'potColor', m.pot_color,
                  'potColorHe', m.pot_color_he,
                  'plantUnitCost', m.plant_unit_cost,
                  'plantUnitCostSource', m.plant_unit_cost_source,
                  'potUnitCost', m.pot_unit_cost,
                  'potUnitCostSource', m.pot_unit_cost_source
                )
                ORDER BY m.line_no
              )
              FROM matched m
            ), '[]'::jsonb)
          ) AS catalog_snapshot,
          (
            SELECT round(SUM(m.server_unit_price * m.quantity), 2)
            FROM matched m
          ) AS amount,
          (SELECT m.server_plant_id FROM matched m ORDER BY m.line_no LIMIT 1) AS product_id,
          CASE
            WHEN (SELECT COUNT(*) FROM matched) = 1
              THEN (SELECT m.plant_name FROM matched m ORDER BY m.line_no LIMIT 1)
            ELSE 'Urban Plant (' || (SELECT COUNT(*) FROM matched)::text || ' items)'
          END AS product_name
        ),
        attempt_ins AS (
          INSERT INTO payment_attempts (
            id,
            status,
            pos_spot_id,
            channel,
            catalog_snapshot,
            offer_id,
            product_id,
            product_name,
            full_name,
            customer_email,
            phone,
            address,
            apartment_or_notes,
            fulfillment_method,
            amount,
            snapshot,
            checkout_session_id,
            cardcom_env,
            payment_resume_token,
            payment_retry_lock_at,
            expires_at,
            failure_reason,
            finalized_order_id,
            cardcom_transaction_id,
            created_at,
            updated_at
          )
          SELECT
            ${input.attemptId}::uuid,
            'created',
            NULL::uuid,
            'catalog',
            s.catalog_snapshot,
            NULL,
            s.product_id,
            s.product_name,
            ${input.fullName},
            ${input.customerEmail},
            ${input.phone},
            ${input.address},
            ${input.apartmentOrNotes},
            'delivery',
            s.amount,
            NULL::jsonb,
            NULL,
            NULL,
            ${input.resumeToken},
            NULL::timestamptz,
            now() + (${PAYMENT_HOLD_TTL_MS} * interval '1 millisecond'),
            NULL,
            NULL::uuid,
            NULL::bigint,
            now(),
            now()
          FROM decision d
          CROSS JOIN snapshot s
          WHERE NOT d.cart_changed
            AND NOT d.insufficient
            AND s.product_id IS NOT NULL
            AND s.product_name IS NOT NULL
            AND s.amount > 0
          RETURNING id
        ),
        hold_ins AS (
          INSERT INTO catalog_stock_holds (
            attempt_id,
            plant_variant_id,
            pot_color_id,
            quantity,
            status,
            expires_at,
            created_at,
            updated_at
          )
          SELECT
            a.id,
            av.plant_variant_id,
            NULL::uuid,
            av.quantity,
            'active',
            now() + (${PAYMENT_HOLD_TTL_MS} * interval '1 millisecond'),
            now(),
            now()
          FROM attempt_ins a
          CROSS JOIN plant_availability av
          UNION ALL
          SELECT
            a.id,
            NULL::uuid,
            cv.pot_color_id,
            cv.quantity,
            'active',
            now() + (${PAYMENT_HOLD_TTL_MS} * interval '1 millisecond'),
            now(),
            now()
          FROM attempt_ins a
          CROSS JOIN color_availability cv
          RETURNING id
        ),
        guard AS (
          SELECT 1 / CASE
            WHEN (SELECT cart_changed OR insufficient FROM decision) THEN 1
            WHEN (SELECT id FROM attempt_ins) IS NOT NULL
              AND (SELECT COUNT(*) FROM hold_ins) =
                (SELECT COUNT(*) FROM plant_availability) + (SELECT COUNT(*) FROM color_availability)
              AND (SELECT COUNT(*) FROM plant_availability) + (SELECT COUNT(*) FROM color_availability)
                = ${expectedHoldCount}
            THEN 1
            ELSE 0
          END AS ok
        )
        SELECT
          d.cart_changed,
          d.insufficient,
          (SELECT id FROM attempt_ins) AS attempt_id,
          (SELECT COUNT(*)::int FROM hold_ins) AS hold_count,
          (SELECT COUNT(*)::int FROM plant_availability)
            + (SELECT COUNT(*)::int FROM color_availability) AS resource_count,
          (SELECT ok FROM guard) AS guard_ok
        FROM decision d
      `,
    ]);
    rows = results[results.length - 1] as CreateRow[];
  } catch (error) {
    if (pgCode(error) === "22P02") {
      return {
        ok: false,
        code: "cart_changed",
        error: "The cart changed. Review it and try again.",
        httpStatus: 409,
      };
    }
    console.error("[catalog-payment] attempt create failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return {
      ok: false,
      code: "server_error",
      error: "Could not start payment. Try again.",
      httpStatus: 500,
    };
  }

  const row = rows[0];
  if (!row) {
    return {
      ok: false,
      code: "server_error",
      error: "Could not start payment. Try again.",
      httpStatus: 500,
    };
  }
  if (row.cart_changed) {
    if (row.attempt_id) await compensateCatalogPaymentPrep(input.attemptId, "cart_changed");
    return {
      ok: false,
      code: "cart_changed",
      error: "The cart changed. Review it and try again.",
      httpStatus: 409,
    };
  }
  if (row.insufficient) {
    if (row.attempt_id) {
      await compensateCatalogPaymentPrep(input.attemptId, "insufficient_stock");
    }
    return {
      ok: false,
      code: "insufficient_stock",
      error: "Not enough stock to start payment.",
      httpStatus: 409,
    };
  }
  if (!row.attempt_id || Number(row.hold_count) !== expectedHoldCount) {
    if (row.attempt_id) {
      await compensateCatalogPaymentPrep(input.attemptId, CANCEL_REASON_PAYMENT_PREP_FAILED);
    }
    return {
      ok: false,
      code: "server_error",
      error: "Could not start payment. Try again.",
      httpStatus: 500,
    };
  }
  return { ok: true, attemptId: input.attemptId };
}

/**
 * Validate the submitted Catalog cart against current server data, then create
 * one catalog payment attempt, its plant and color holds, and the Cardcom payment.
 */
export async function startCatalogCardcomPayment(
  input: StartCatalogCardcomPaymentInput,
  deps: StartCatalogCardcomPaymentDeps = {},
): Promise<StartCatalogCardcomPaymentResult> {
  const lines = parseLines(input.lines);
  if (!lines) return validationFailure("Invalid catalog cart");
  if (typeof input.emailOptIn !== "boolean") {
    return validationFailure("emailOptIn is required");
  }

  const nameStr = input.fullName.trim();
  const phoneStr = input.phone.trim();
  let emailTrim = (input.customerEmail ?? "").trim().toLowerCase();
  const customerError = getCheckoutCustomerServerError({
    fulfillmentMethod: "delivery",
    emailOptIn: input.emailOptIn,
    fullName: nameStr,
    email: emailTrim,
    phone: phoneStr,
  });
  if (customerError) return validationFailure(customerError);
  if (!input.emailOptIn) emailTrim = "";

  const resolved = resolveDeliveryAddressFromRequest({
    deliveryStreet: input.deliveryStreet,
    deliveryHouseNumber: input.deliveryHouseNumber,
    apartmentOrNotes: input.apartmentOrNotes,
    address: input.address,
  });
  if (resolved.error || !resolved.address.trim()) {
    return validationFailure(resolved.error || "address is required");
  }

  const attemptId = randomUUID();
  const resumeToken = createPaymentResumeToken();
  let prepared = false;
  try {
    const created = await createCatalogAttemptAndHolds({
      attemptId,
      resumeToken,
      lines,
      fullName: nameStr,
      customerEmail: emailTrim,
      phone: phoneStr,
      address: resolved.address,
      apartmentOrNotes:
        typeof input.apartmentOrNotes === "string" ? input.apartmentOrNotes.trim() : "",
    });
    if (!created.ok) return created;
    prepared = true;

    const attempt = await getPaymentAttemptById(attemptId);
    if (
      !attempt ||
      attempt.channel !== "catalog" ||
      attempt.posSpotId != null ||
      !attempt.catalogSnapshot ||
      attempt.catalogSnapshot.lines.length !== lines.length
    ) {
      await compensateCatalogPaymentPrep(attemptId, CANCEL_REASON_PAYMENT_PREP_FAILED);
      prepared = false;
      return {
        ok: false,
        code: "server_error",
        error: "Could not start payment. Try again.",
        httpStatus: 500,
      };
    }

    let publicOrigin: string;
    try {
      publicOrigin = resolvePublicOrigin(deps.publicOrigin);
    } catch {
      await compensateCatalogPaymentPrep(attemptId, CANCEL_REASON_CARDCOM_CREATE_FAILED);
      prepared = false;
      return {
        ok: false,
        code: "config",
        error: "Payment is temporarily unavailable. Try again later.",
        httpStatus: 500,
      };
    }

    let productName: string;
    try {
      productName = catalogCardcomProductName(attempt);
    } catch {
      await compensateCatalogPaymentPrep(attemptId, CANCEL_REASON_PAYMENT_PREP_FAILED);
      prepared = false;
      return {
        ok: false,
        code: "server_error",
        error: "Could not start payment. Try again.",
        httpStatus: 500,
      };
    }

    const callbacks = catalogCallbackUrls(publicOrigin, attempt.id, attempt.paymentResumeToken);
    const cardcomEnvironment: CardcomEnvironment =
      deps.cardcomEnvironment === "test" ? "test" : "production";
    const createInput: CreateCardcomLowProfileInput = {
      amount: attempt.amount,
      returnValue: attempt.id,
      productName,
      successRedirectUrl: callbacks.successRedirectUrl,
      failedRedirectUrl: callbacks.failedRedirectUrl,
      webHookUrl: callbacks.webHookUrl,
      cardOwnerName: attempt.fullName,
      cardOwnerPhone: attempt.phone,
      cardOwnerEmail: attempt.customerEmail,
    };
    const createFn =
      deps.createLowProfile ??
      ((payload: CreateCardcomLowProfileInput) =>
        createCardcomLowProfile(payload, { environment: cardcomEnvironment }));

    let cardcomResult: CardcomLowProfileCreateResponse;
    try {
      cardcomResult = await createFn(createInput);
    } catch (error) {
      const mapped = mapCardcomFailure(error);
      await compensateCatalogPaymentPrep(attemptId, mapped.reason);
      prepared = false;
      return {
        ok: false,
        code: mapped.code,
        error: mapped.error,
        httpStatus: mapped.httpStatus,
      };
    }

    const lowProfileId = cardcomResult.LowProfileId?.trim() ?? "";
    const paymentUrl = cardcomResult.Url?.trim() ?? "";
    if (!lowProfileId || !paymentUrl) {
      await compensateCatalogPaymentPrep(attemptId, CANCEL_REASON_CARDCOM_RESPONSE_INVALID);
      prepared = false;
      return {
        ok: false,
        code: "cardcom_error",
        error: "Could not start payment. Try again.",
        httpStatus: 502,
      };
    }

    const attach = await attachCheckoutSessionIdToAttempt(attempt.id, lowProfileId, {
      cardcomEnv: cardcomEnvironment,
    });
    if (!attach.ok) {
      await compensateCatalogPaymentPrep(attemptId, CANCEL_REASON_CARDCOM_SESSION_ATTACH_FAILED);
      prepared = false;
      return {
        ok: false,
        code: "server_error",
        error: "Could not start payment. Try again.",
        httpStatus: 500,
      };
    }

    prepared = false;
    return {
      ok: true,
      orderId: attempt.id,
      attemptId: attempt.id,
      lowProfileId,
      paymentUrl,
    };
  } catch (error) {
    if (prepared) {
      await compensateCatalogPaymentPrep(attemptId, CANCEL_REASON_PAYMENT_PREP_FAILED);
    }
    console.error("[catalog-payment] start failed", {
      attemptId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return {
      ok: false,
      code: "server_error",
      error: "Could not start payment. Try again.",
      httpStatus: 500,
    };
  }
}

async function catalogHoldsAllowRetry(attemptId: string): Promise<boolean> {
  const rows = await sql`
    WITH plant_expected AS (
      SELECT
        (line->>'plantVariantId')::uuid AS resource_id,
        SUM((line->>'quantity')::int)::int AS quantity
      FROM payment_attempts a
      CROSS JOIN LATERAL jsonb_array_elements(a.catalog_snapshot->'lines') AS line
      WHERE a.id = ${attemptId}::uuid
        AND a.channel = 'catalog'
      GROUP BY 1
    ),
    color_expected AS (
      SELECT
        NULLIF(line->>'potColorId', '')::uuid AS resource_id,
        SUM((line->>'quantity')::int)::int AS quantity
      FROM payment_attempts a
      CROSS JOIN LATERAL jsonb_array_elements(a.catalog_snapshot->'lines') AS line
      WHERE a.id = ${attemptId}::uuid
        AND a.channel = 'catalog'
        AND NULLIF(line->>'potColorId', '') IS NOT NULL
      GROUP BY 1
    ),
    active_plant AS (
      SELECT h.plant_variant_id AS resource_id, h.quantity
      FROM catalog_stock_holds h
      WHERE h.attempt_id = ${attemptId}::uuid
        AND h.status = 'active'
        AND h.expires_at > now()
        AND h.plant_variant_id IS NOT NULL
    ),
    active_color AS (
      SELECT h.pot_color_id AS resource_id, h.quantity
      FROM catalog_stock_holds h
      WHERE h.attempt_id = ${attemptId}::uuid
        AND h.status = 'active'
        AND h.expires_at > now()
        AND h.pot_color_id IS NOT NULL
    )
    SELECT (
      (SELECT COUNT(*) FROM plant_expected) > 0
      AND (SELECT COUNT(*) FROM plant_expected) = (SELECT COUNT(*) FROM active_plant)
      AND (SELECT COUNT(*) FROM color_expected) = (SELECT COUNT(*) FROM active_color)
      AND (SELECT COUNT(*) FROM catalog_stock_holds WHERE attempt_id = ${attemptId}::uuid)
        = (SELECT COUNT(*) FROM plant_expected) + (SELECT COUNT(*) FROM color_expected)
      AND NOT EXISTS (
        SELECT 1
        FROM plant_expected e
        FULL OUTER JOIN active_plant a ON a.resource_id = e.resource_id
        WHERE e.quantity IS DISTINCT FROM a.quantity
      )
      AND NOT EXISTS (
        SELECT 1
        FROM color_expected e
        FULL OUTER JOIN active_color a ON a.resource_id = e.resource_id
        WHERE e.quantity IS DISTINCT FROM a.quantity
      )
    ) AS ok
  `;
  return (rows as { ok: boolean }[])[0]?.ok === true;
}

/**
 * New Cardcom session for the same catalog attempt.
 * Does not create an attempt and does not acquire more stock.
 */
export async function retryCatalogCardcomPayment(
  attemptId: string,
  resumeToken: string,
  deps: {
    publicOrigin?: string;
    createLowProfile?: (
      createInput: CreateCardcomLowProfileInput,
    ) => Promise<{ LowProfileId?: string; Url?: string; ResponseCode?: number }>;
    cardcomEnvironment?: CardcomEnvironment;
  },
): Promise<RetryCardcomPaymentResult> {
  const id = attemptId.trim();
  const token = resumeToken.trim();
  await expireStaleCatalogStockHolds({ attemptId: id });

  const attempt = await getAwaitingPaymentAttemptForResume(id, token);
  if (!attempt || attempt.channel !== "catalog") {
    return {
      ok: false,
      code: "unauthorized",
      error: "Payment session is not available to retry.",
      httpStatus: 403,
    };
  }

  const holdsOk = await catalogHoldsAllowRetry(attempt.id);
  if (!holdsOk) {
    return {
      ok: false,
      code: "conflict",
      error: "This order is no longer held for your payment.",
      httpStatus: 409,
    };
  }

  let publicOrigin: string;
  try {
    if (deps.publicOrigin?.trim()) {
      publicOrigin = new URL(deps.publicOrigin.trim()).origin;
    } else {
      publicOrigin = getPublicAppOrigin();
    }
  } catch {
    return {
      ok: false,
      code: "config",
      error: "Payment is temporarily unavailable. Try again later.",
      httpStatus: 500,
    };
  }

  let productName: string;
  try {
    productName = catalogCardcomProductName(attempt);
  } catch {
    return {
      ok: false,
      code: "server_error",
      error: "Could not retry payment. Try again.",
      httpStatus: 500,
    };
  }

  const claimed = await claimPaymentAttemptRetryLock({
    attemptId: attempt.id,
    resumeToken: attempt.paymentResumeToken,
  });
  if (!claimed.ok) {
    if (claimed.reason === "busy") {
      return {
        ok: false,
        code: "busy",
        error: "Payment is already being prepared. Please wait.",
        httpStatus: 409,
      };
    }
    if (claimed.reason === "not_awaiting" || claimed.reason === "token_mismatch") {
      return {
        ok: false,
        code: "unauthorized",
        error: "Payment session is not available to retry.",
        httpStatus: 403,
      };
    }
    return {
      ok: false,
      code: "conflict",
      error: "Could not retry payment. Try again.",
      httpStatus: 409,
    };
  }

  const callbacks = catalogCallbackUrls(publicOrigin, attempt.id, attempt.paymentResumeToken);
  const cardcomEnvironment: CardcomEnvironment =
    deps.cardcomEnvironment === "test"
      ? "test"
      : attempt.cardcomEnv === "test"
        ? "test"
        : "production";
  const createInput: CreateCardcomLowProfileInput = {
    amount: attempt.amount,
    returnValue: attempt.id,
    productName,
    successRedirectUrl: callbacks.successRedirectUrl,
    failedRedirectUrl: callbacks.failedRedirectUrl,
    webHookUrl: callbacks.webHookUrl,
    cardOwnerName: attempt.fullName,
    cardOwnerPhone: attempt.phone,
    cardOwnerEmail: attempt.customerEmail,
  };
  const createFn =
    deps.createLowProfile ??
    ((payload: CreateCardcomLowProfileInput) =>
      createCardcomLowProfile(payload, { environment: cardcomEnvironment }));

  let cardcomResult: { LowProfileId?: string; Url?: string };
  try {
    cardcomResult = await createFn(createInput);
  } catch (error) {
    await releasePaymentAttemptRetryLock(attempt.id);
    if (error instanceof CardcomError && error.code === "config") {
      return {
        ok: false,
        code: "config",
        error: "Payment is temporarily unavailable. Try again later.",
        httpStatus: 500,
      };
    }
    return {
      ok: false,
      code: "cardcom_error",
      error: "Could not retry payment. Try again.",
      httpStatus: 502,
    };
  }

  const lowProfileId = cardcomResult.LowProfileId?.trim() ?? "";
  const paymentUrl = cardcomResult.Url?.trim() ?? "";
  if (!lowProfileId || !paymentUrl) {
    await releasePaymentAttemptRetryLock(attempt.id);
    return {
      ok: false,
      code: "cardcom_error",
      error: "Could not retry payment. Try again.",
      httpStatus: 502,
    };
  }

  const rotated = await rotateCheckoutSessionIdForAttemptResume({
    attemptId: attempt.id,
    resumeToken: attempt.paymentResumeToken,
    newCheckoutSessionId: lowProfileId,
    cardcomEnv: cardcomEnvironment,
  });
  if (!rotated.ok) {
    await releasePaymentAttemptRetryLock(attempt.id);
    return {
      ok: false,
      code:
        rotated.reason === "token_mismatch"
          ? "unauthorized"
          : rotated.reason === "not_found"
            ? "not_found"
            : "conflict",
      error: "Could not retry payment. Try again.",
      httpStatus: rotated.reason === "token_mismatch" ? 403 : 409,
    };
  }

  await releasePaymentAttemptRetryLock(attempt.id);
  return {
    ok: true,
    orderId: attempt.id,
    lowProfileId,
    paymentUrl,
  };
}
