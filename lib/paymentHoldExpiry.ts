/**
 * Abandoned Cardcom payment hold expiry (17 minutes).
 * Owned holds: expire awaiting attempt + release only that attempt's hold (no Order).
 * Legacy holds (null owner): cancel pending_payment Orders + release as before.
 *
 * Canonical rule: a held_for_payment hold is active only while its hold timestamp
 * is less than {@link PAYMENT_HOLD_TTL_MS} old (DB `now()` for SQL comparisons).
 * Missing/invalid timestamps are treated as expired and repaired to available.
 */

import "server-only";

import { sql } from "@/lib/db";

/** How long a POS may stay held_for_payment without verified payment. */
export const PAYMENT_HOLD_TTL_MS = 17 * 60 * 1000;

/** Postgres interval matching {@link PAYMENT_HOLD_TTL_MS} (documentation / logs). */
export const PAYMENT_HOLD_TTL_SQL = "17 minutes";

export type ExpireStalePaymentHoldResult =
  | { expired: false; reason: "not_held" | "not_stale" | "not_found" | "already_sold" }
  | {
      expired: true;
      posSpotId: string;
      cancelledOrderId: string | null;
      expiredAttemptId?: string | null;
    };

export type ExpireAllStalePaymentHoldsResult = {
  candidateCount: number;
  expiredCount: number;
  expiredPosSpotIds: string[];
};

/**
 * If this POS has been held_for_payment longer than the TTL without verified payment:
 * - owned hold: expire awaiting payment_attempt; release only if owner matches
 * - legacy hold: cancel linked pending_payment order(s); release hold
 * - missing hold timestamp (after fallbacks): treat as expired and release
 * Never releases sold / inactive / another attempt's hold / a newer fresh hold.
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
        p.payment_hold_attempt_id AS attempt_id,
        COALESCE(
          p.payment_hold_started_at,
          (
            SELECT MIN(o.created_at)
            FROM orders o
            WHERE o.pos_spot_id = p.id
              AND o.order_status = 'pending_payment'
          ),
          (
            SELECT MIN(a.created_at)
            FROM payment_attempts a
            WHERE a.id = p.payment_hold_attempt_id
          )
        ) AS hold_started_at
      FROM pos_spots p
      WHERE p.id = ${id}::uuid
        AND p.status = 'held_for_payment'
    ),
    stale AS (
      SELECT pos_spot_id, attempt_id, hold_started_at
      FROM candidate
      WHERE hold_started_at IS NULL
         OR (EXTRACT(EPOCH FROM (now() - hold_started_at)) * 1000) >= ${PAYMENT_HOLD_TTL_MS}
    ),
    expired_attempts AS (
      UPDATE payment_attempts a
      SET
        status = 'expired',
        failure_reason = 'Payment hold expired',
        payment_retry_lock_at = NULL,
        updated_at = now()
      FROM stale s
      WHERE s.attempt_id IS NOT NULL
        AND a.id = s.attempt_id
        AND a.status = 'awaiting_payment'
      RETURNING a.id
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
      WHERE s.attempt_id IS NULL
        AND o.pos_spot_id = s.pos_spot_id
        AND o.order_status = 'pending_payment'
      RETURNING o.order_id
    ),
    released_pos AS (
      UPDATE pos_spots p
      SET
        status = 'available',
        payment_hold_started_at = NULL,
        payment_hold_attempt_id = NULL
      FROM stale s
      WHERE p.id = s.pos_spot_id
        AND p.status = 'held_for_payment'
        -- Still stale at update time (blocks releasing a newer hold after re-acquire).
        AND (
          p.payment_hold_started_at IS NULL
          OR (EXTRACT(EPOCH FROM (now() - p.payment_hold_started_at)) * 1000) >= ${PAYMENT_HOLD_TTL_MS}
        )
        -- Ownership must still match the candidate snapshot (concurrency guard).
        AND (
          (
            s.attempt_id IS NULL
            AND p.payment_hold_attempt_id IS NULL
          )
          OR (
            s.attempt_id IS NOT NULL
            AND p.payment_hold_attempt_id IS NOT DISTINCT FROM s.attempt_id
          )
        )
      RETURNING p.id
    )
    SELECT
      (SELECT id FROM released_pos LIMIT 1) AS released_pos_id,
      (SELECT order_id FROM cancelled_orders LIMIT 1) AS cancelled_order_id,
      (SELECT id FROM expired_attempts LIMIT 1) AS expired_attempt_id,
      (SELECT hold_started_at FROM candidate LIMIT 1) AS hold_started_at,
      (SELECT status FROM pos_spots WHERE id = ${id}::uuid LIMIT 1) AS current_status
  `;

  const row = (
    rows as {
      released_pos_id: string | null;
      cancelled_order_id: string | null;
      expired_attempt_id: string | null;
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
      expiredAttemptId: row.expired_attempt_id,
    };
  }
  if (row.current_status !== "held_for_payment") {
    return { expired: false, reason: "not_held" };
  }
  return { expired: false, reason: "not_stale" };
}

/**
 * Background / cron entry point: find every held_for_payment spot past the TTL
 * (or with a missing hold clock), then reuse {@link expireStalePaymentHold} per spot.
 */
export async function expireAllStalePaymentHolds(): Promise<ExpireAllStalePaymentHoldsResult> {
  console.log("[expire-payment-holds] cleanup start");

  const rows = await sql`
    SELECT p.id
    FROM pos_spots p
    WHERE p.status = 'held_for_payment'
      AND (
        COALESCE(
          p.payment_hold_started_at,
          (
            SELECT MIN(o.created_at)
            FROM orders o
            WHERE o.pos_spot_id = p.id
              AND o.order_status = 'pending_payment'
          ),
          (
            SELECT MIN(a.created_at)
            FROM payment_attempts a
            WHERE a.id = p.payment_hold_attempt_id
          )
        ) IS NULL
        OR (
          EXTRACT(
            EPOCH FROM (
              now() - COALESCE(
                p.payment_hold_started_at,
                (
                  SELECT MIN(o.created_at)
                  FROM orders o
                  WHERE o.pos_spot_id = p.id
                    AND o.order_status = 'pending_payment'
                ),
                (
                  SELECT MIN(a.created_at)
                  FROM payment_attempts a
                  WHERE a.id = p.payment_hold_attempt_id
                )
              )
            )
          ) * 1000
        ) >= ${PAYMENT_HOLD_TTL_MS}
      )
  `;

  const candidateIds = (rows as { id: string }[]).map((r) => r.id);
  const expiredPosSpotIds: string[] = [];

  console.log(
    `[expire-payment-holds] candidates found=${candidateIds.length}`,
  );

  for (const id of candidateIds) {
    const result = await expireStalePaymentHold(id);
    if (result.expired) {
      expiredPosSpotIds.push(result.posSpotId);
    }
  }

  console.log(
    `[expire-payment-holds] released=${expiredPosSpotIds.length} of ${candidateIds.length} candidates`,
  );

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

/**
 * True when hold_started_at is missing, invalid, or older than the TTL.
 * Pure helper for tests and app-side checks (DB expiry uses {@link expireStalePaymentHold}).
 */
export function isPaymentHoldExpired(
  holdStartedAt: Date | string | null | undefined,
  nowMs: number = Date.now(),
  ttlMs: number = PAYMENT_HOLD_TTL_MS,
): boolean {
  if (holdStartedAt == null || holdStartedAt === "") return true;
  const started =
    holdStartedAt instanceof Date ? holdStartedAt.getTime() : Date.parse(String(holdStartedAt));
  if (!Number.isFinite(started)) return true;
  return nowMs - started >= ttlMs;
}
