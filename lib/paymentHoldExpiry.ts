/**
 * Abandoned Cardcom payment hold expiry (17 minutes).
 * Intentionally longer than Cardcom terminal TimeOut (15 minutes) so Cardcom can
 * redirect to FailedRedirectUrl before Urban Plant releases the POS.
 *
 * Enforcement:
 * - Lazy cleanup on product/checkout/create/retry/webhook paths
 * - Scheduled cleanup via {@link expireAllStalePaymentHolds} (Netlify cron → API route)
 *
 * Not a browser timer. TTL must stay at 17 minutes.
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

export type ExpireAllStalePaymentHoldsResult = {
  /** Spots that matched the stale criteria when scanned. */
  candidateCount: number;
  /** Spots successfully released by {@link expireStalePaymentHold}. */
  expiredCount: number;
  expiredPosSpotIds: string[];
};

/**
 * If this POS has been held_for_payment longer than the TTL without verified payment:
 * - cancel linked pending_payment order(s) (never sold/picked_up/delivered)
 * - return POS to available (never if already sold)
 *
 * Lazy: call on product/checkout reads, create, retry, and webhook before finalize.
 * Scheduled: {@link expireAllStalePaymentHolds} reuses this same function per spot.
 * Runs as a single SQL statement (CTE) — cancel + POS release are atomic together.
 *
 * Concurrent Cardcom webhook safety: finalize requires pending_payment + held_for_payment
 * in one atomic UPDATE. If expiry wins first, webhook sees cancelled / not held and
 * fails closed (ignored_cancelled). If finalize wins first, expiry only cancels
 * pending_payment and only releases while still held_for_payment — sold is untouched.
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

/**
 * Background / cron entry point: find every held_for_payment spot past the TTL,
 * then reuse {@link expireStalePaymentHold} per spot (same rules, idempotent).
 *
 * Candidate hold start matches single-spot expiry:
 * COALESCE(payment_hold_started_at, MIN(pending_payment.created_at)).
 */
export async function expireAllStalePaymentHolds(): Promise<ExpireAllStalePaymentHoldsResult> {
  const rows = await sql`
    SELECT p.id
    FROM pos_spots p
    WHERE p.status = 'held_for_payment'
      AND COALESCE(
        p.payment_hold_started_at,
        (
          SELECT MIN(o.created_at)
          FROM orders o
          WHERE o.pos_spot_id = p.id
            AND o.order_status = 'pending_payment'
        )
      ) IS NOT NULL
      AND COALESCE(
        p.payment_hold_started_at,
        (
          SELECT MIN(o.created_at)
          FROM orders o
          WHERE o.pos_spot_id = p.id
            AND o.order_status = 'pending_payment'
        )
      ) <= (now() - interval '17 minutes')
  `;

  const candidateIds = (rows as { id: string }[]).map((r) => r.id);
  const expiredPosSpotIds: string[] = [];

  for (const id of candidateIds) {
    const result = await expireStalePaymentHold(id);
    if (result.expired) {
      expiredPosSpotIds.push(result.posSpotId);
    }
  }

  return {
    candidateCount: candidateIds.length,
    expiredCount: expiredPosSpotIds.length,
    expiredPosSpotIds,
  };
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
