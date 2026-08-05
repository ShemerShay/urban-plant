/**
 * Abandoned Cardcom payment hold expiry (17 minutes).
 * Intentionally longer than Cardcom terminal TimeOut (15 minutes) so Cardcom can
 * redirect to FailedRedirectUrl before Urban Plant releases the POS.
 * Enforced server-side via lazy cleanup on read/request paths — not a browser timer.
 */

import "server-only";

import { sql } from "@/lib/db";

/** How long a POS may stay held_for_payment without verified payment. */
export const PAYMENT_HOLD_TTL_MS = 17 * 60 * 1000;

/** Postgres interval matching {@link PAYMENT_HOLD_TTL_MS}. */
export const PAYMENT_HOLD_TTL_SQL = "17 minutes";

export type ExpireStalePaymentHoldResult =
  | { expired: false; reason: "not_held" | "not_stale" | "not_found" | "already_sold" }
  | {
      expired: true;
      posSpotId: string;
      cancelledOrderId: string | null;
    };

/**
 * If this POS has been held_for_payment longer than the TTL without verified payment:
 * - cancel linked pending_payment order(s) (never sold/picked_up/delivered)
 * - return POS to available (never if already sold)
 *
 * Lazy: call on product/checkout reads, create, retry, and webhook before finalize.
 * Runs as a single SQL statement (CTE) — cancel + POS release are atomic together.
 */
export async function expireStalePaymentHold(
  posSpotId: string,
): Promise<ExpireStalePaymentHoldResult> {
  const id = posSpotId.trim();
  if (!id) return { expired: false, reason: "not_found" };

  const rows = await sql`
    WITH candidate AS (
      SELECT
        p.id AS pos_spot_id,
        COALESCE(
          p.payment_hold_started_at,
          (
            SELECT MIN(o.created_at)
            FROM orders o
            WHERE o.pos_spot_id = p.id
              AND o.order_status = 'pending_payment'
          )
        ) AS hold_started_at
      FROM pos_spots p
      WHERE p.id = ${id}::uuid
        AND p.status = 'held_for_payment'
    ),
    stale AS (
      SELECT pos_spot_id, hold_started_at
      FROM candidate
      WHERE hold_started_at IS NOT NULL
        AND hold_started_at <= (now() - interval '17 minutes')
    ),
    cancelled_orders AS (
      UPDATE orders o
      SET
        order_status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = 'system',
        cancellation_reason = 'Payment hold expired',
        delivered_at = NULL,
        picked_up_at = NULL,
        payment_retry_lock_at = NULL
      FROM stale s
      WHERE o.pos_spot_id = s.pos_spot_id
        AND o.order_status = 'pending_payment'
      RETURNING o.order_id
    ),
    released_pos AS (
      UPDATE pos_spots p
      SET
        status = 'available',
        payment_hold_started_at = NULL
      FROM stale s
      WHERE p.id = s.pos_spot_id
        AND p.status = 'held_for_payment'
      RETURNING p.id
    )
    SELECT
      (SELECT id FROM released_pos LIMIT 1) AS released_pos_id,
      (SELECT order_id FROM cancelled_orders LIMIT 1) AS cancelled_order_id,
      (SELECT hold_started_at FROM candidate LIMIT 1) AS hold_started_at,
      (SELECT status FROM pos_spots WHERE id = ${id}::uuid LIMIT 1) AS current_status
  `;

  const row = (
    rows as {
      released_pos_id: string | null;
      cancelled_order_id: string | null;
      hold_started_at: string | Date | null;
      current_status: string | null;
    }[]
  )[0];

  if (!row) {
    return { expired: false, reason: "not_found" };
  }
  if (row.current_status === "sold") {
    return { expired: false, reason: "already_sold" };
  }
  if (row.released_pos_id) {
    return {
      expired: true,
      posSpotId: row.released_pos_id,
      cancelledOrderId: row.cancelled_order_id,
    };
  }
  if (row.current_status !== "held_for_payment") {
    return { expired: false, reason: "not_held" };
  }
  return { expired: false, reason: "not_stale" };
}

export async function expireStalePaymentHoldBySpotSlug(
  spotSlug: string,
): Promise<ExpireStalePaymentHoldResult> {
  const slug = spotSlug.trim();
  if (!slug) return { expired: false, reason: "not_found" };
  const rows = await sql`
    SELECT id FROM pos_spots WHERE spot_slug = ${slug} LIMIT 1
  `;
  const id = (rows as { id: string }[])[0]?.id;
  if (!id) return { expired: false, reason: "not_found" };
  return expireStalePaymentHold(id);
}

/** True when hold_started_at is older than the TTL (pure helper for tests). */
export function isPaymentHoldExpired(
  holdStartedAt: Date | string | null | undefined,
  nowMs: number = Date.now(),
  ttlMs: number = PAYMENT_HOLD_TTL_MS,
): boolean {
  if (!holdStartedAt) return false;
  const started =
    holdStartedAt instanceof Date ? holdStartedAt.getTime() : Date.parse(holdStartedAt);
  if (!Number.isFinite(started)) return false;
  return nowMs - started >= ttlMs;
}
