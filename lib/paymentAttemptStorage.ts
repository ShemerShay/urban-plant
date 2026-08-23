/**
 * Payment attempt persistence (Option B).
 * Correlation record before verified payment; Order created only on finalize.
 */

import "server-only";

import { sql } from "@/lib/db";
import { paymentResumeTokensEqual } from "@/lib/paymentResume";
import { parseNumeric, toIsoString } from "@/lib/storageUtils";

import type { FulfillmentMethod, OrderSnapshot, SavedOrder } from "./orderTypes";
import type { PaymentAttemptStatus, SavedPaymentAttempt } from "./paymentAttemptTypes";
import { isPaymentAttemptStatus } from "./paymentAttemptTypes";

function normalizeSnapshot(value: unknown): OrderSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const o = value as Record<string, unknown>;
  const productId = typeof o.productId === "string" ? o.productId : "";
  const productName = typeof o.productName === "string" ? o.productName : "";
  const productDescription =
    typeof o.productDescription === "string" ? o.productDescription : "";
  const offerId = typeof o.offerId === "string" ? o.offerId : "";
  const consumerPrice =
    typeof o.consumerPrice === "number" && Number.isFinite(o.consumerPrice)
      ? o.consumerPrice
      : null;
  const fulfillmentType: FulfillmentMethod =
    o.fulfillmentType === "pickup" ? "pickup" : "delivery";
  if (!productId || !productName || !productDescription || !offerId || consumerPrice === null) {
    return undefined;
  }

  return {
    productId,
    productName,
    ...(typeof o.productFamily === "string" && o.productFamily
      ? { productFamily: o.productFamily }
      : {}),
    ...(typeof o.productImage === "string" && o.productImage
      ? { productImage: o.productImage }
      : {}),
    productDescription,
    offerId,
    consumerPrice,
    ...(typeof o.supplierPrice === "number" && Number.isFinite(o.supplierPrice)
      ? { supplierPrice: o.supplierPrice }
      : {}),
    ...(typeof o.supplierName === "string" && o.supplierName
      ? { supplierName: o.supplierName }
      : {}),
    ...(typeof o.partnerLocationId === "string" && o.partnerLocationId
      ? { partnerLocationId: o.partnerLocationId }
      : {}),
    ...(typeof o.partnerLocationName === "string" && o.partnerLocationName
      ? { partnerLocationName: o.partnerLocationName }
      : {}),
    ...(typeof o.posSpotId === "string" && o.posSpotId ? { posSpotId: o.posSpotId } : {}),
    ...(typeof o.posSpotDescription === "string" && o.posSpotDescription
      ? { posSpotDescription: o.posSpotDescription }
      : {}),
    ...(typeof o.spotSlug === "string" && o.spotSlug ? { spotSlug: o.spotSlug } : {}),
    fulfillmentType,
  };
}

function parseOptionalBigInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  if (typeof value === "bigint") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code =
    "code" in error && typeof (error as { code: unknown }).code === "string"
      ? (error as { code: string }).code
      : undefined;
  if (code === "23505") return true;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          "message" in error &&
          typeof (error as { message: unknown }).message === "string"
        ? (error as { message: string }).message
        : "";
  return /unique|duplicate key/i.test(message);
}

type PaymentAttemptRow = {
  id: string;
  status: string;
  pos_spot_id: string;
  offer_id: string | null;
  product_id: string;
  product_name: string;
  full_name: string;
  customer_email: string;
  phone: string;
  address: string;
  apartment_or_notes: string;
  fulfillment_method: string;
  amount: string | number;
  snapshot: unknown;
  checkout_session_id: string | null;
  cardcom_env: string | null;
  payment_resume_token: string;
  payment_retry_lock_at: string | Date | null;
  expires_at: string | Date | null;
  failure_reason: string | null;
  finalized_order_id: string | null;
  cardcom_transaction_id: string | number | bigint | null;
  created_at: string | Date;
  updated_at: string | Date;
};

function mapPaymentAttemptRow(row: PaymentAttemptRow): SavedPaymentAttempt {
  const status: PaymentAttemptStatus = isPaymentAttemptStatus(row.status)
    ? row.status
    : "failed";
  const fulfillmentMethod: FulfillmentMethod =
    row.fulfillment_method === "pickup" ? "pickup" : "delivery";
  const snapshot = normalizeSnapshot(row.snapshot);

  return {
    id: String(row.id),
    status,
    posSpotId: row.pos_spot_id,
    ...(row.offer_id ? { offerId: row.offer_id } : {}),
    productId: row.product_id,
    productName: row.product_name,
    fullName: row.full_name,
    customerEmail: row.customer_email,
    phone: row.phone ?? "",
    address: row.address ?? "",
    apartmentOrNotes: row.apartment_or_notes ?? "",
    fulfillmentMethod,
    amount: parseNumeric(row.amount),
    ...(snapshot ? { snapshot } : {}),
    ...(row.checkout_session_id ? { checkoutSessionId: row.checkout_session_id } : {}),
    ...(row.cardcom_env === "test" || row.cardcom_env === "production"
      ? { cardcomEnv: row.cardcom_env }
      : {}),
    paymentResumeToken: row.payment_resume_token,
    ...(toIsoString(row.payment_retry_lock_at)
      ? { paymentRetryLockAt: toIsoString(row.payment_retry_lock_at)! }
      : {}),
    ...(toIsoString(row.expires_at) ? { expiresAt: toIsoString(row.expires_at)! } : {}),
    ...(row.failure_reason ? { failureReason: row.failure_reason } : {}),
    ...(row.finalized_order_id ? { finalizedOrderId: row.finalized_order_id } : {}),
    ...(parseOptionalBigInt(row.cardcom_transaction_id) !== undefined
      ? { cardcomTransactionId: parseOptionalBigInt(row.cardcom_transaction_id) }
      : {}),
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updated_at) ?? new Date().toISOString(),
  };
}

const PAYMENT_ATTEMPT_ROW_SQL = sql`
  id,
  status,
  pos_spot_id,
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
`;

type OrderRow = {
  order_id: string;
  checkout_session_id: string | null;
  cardcom_env: string | null;
  payment_resume_token: string | null;
  pos_spot_id: string | null;
  offer_id: string | null;
  product_id: string;
  product_name: string;
  partner_location_id: string | null;
  partner_location_name: string | null;
  partner_location_address: string | null;
  price: string | number;
  full_name: string;
  customer_email: string | null;
  phone: string;
  address: string;
  apartment_or_notes: string;
  fulfillment_method: string;
  order_status: string;
  source: string | null;
  cancelled_at: string | Date | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  delivered_at: string | Date | null;
  picked_up_at: string | Date | null;
  snapshot: unknown;
  created_at: string | Date;
  cardcom_transaction_id?: string | number | bigint | null;
  cardcom_document_type?: string | null;
  cardcom_document_number?: string | number | bigint | null;
  purchase_email_status?: string | null;
  purchase_email_sent_at?: string | Date | null;
  purchase_email_last_error?: string | null;
};

function mapOrderRowLite(row: OrderRow): SavedOrder {
  const fulfillmentMethod: FulfillmentMethod =
    row.fulfillment_method === "pickup" ? "pickup" : "delivery";
  const snapshot = normalizeSnapshot(row.snapshot);
  const locationId =
    typeof row.partner_location_id === "string" && row.partner_location_id.trim()
      ? row.partner_location_id.trim()
      : null;
  let locationName =
    typeof row.partner_location_name === "string" ? row.partner_location_name : null;
  if (locationName !== null && locationName.trim() === "") locationName = null;
  let locationAddress =
    typeof row.partner_location_address === "string" ? row.partner_location_address : null;
  if (locationAddress !== null && locationAddress.trim() === "") locationAddress = null;
  const customerEmail =
    typeof row.customer_email === "string" && row.customer_email.trim()
      ? row.customer_email.trim()
      : undefined;
  const source =
    row.source === "manual" || row.source === "admin" || row.source === "online"
      ? row.source
      : undefined;
  const orderStatus =
    row.order_status === "pending_payment" ||
    row.order_status === "sold" ||
    row.order_status === "picked_up" ||
    row.order_status === "delivered" ||
    row.order_status === "cancelled"
      ? row.order_status
      : "sold";

  return {
    id: String(row.order_id),
    orderId: String(row.order_id),
    ...(row.checkout_session_id ? { checkoutSessionId: row.checkout_session_id } : {}),
    ...(row.cardcom_env === "test" || row.cardcom_env === "production"
      ? { cardcomEnv: row.cardcom_env }
      : {}),
    ...(row.payment_resume_token ? { paymentResumeToken: row.payment_resume_token } : {}),
    ...(row.pos_spot_id ? { posSpotId: row.pos_spot_id } : {}),
    ...(row.offer_id ? { offerId: row.offer_id } : {}),
    plantId: row.product_id,
    plantName: row.product_name,
    locationId,
    locationName,
    locationAddress,
    price: parseNumeric(row.price),
    fullName: row.full_name,
    ...(customerEmail ? { customerEmail } : {}),
    phone: row.phone ?? "",
    address: row.address ?? "",
    apartmentOrNotes: row.apartment_or_notes ?? "",
    fulfillmentMethod,
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
    orderStatus,
    ...(source ? { source } : {}),
    ...(toIsoString(row.cancelled_at) ? { cancelledAt: toIsoString(row.cancelled_at) } : {}),
    ...(row.cancelled_by ? { cancelledBy: row.cancelled_by } : {}),
    ...(row.cancellation_reason ? { cancellationReason: row.cancellation_reason } : {}),
    ...(snapshot ? { snapshot } : {}),
    ...(toIsoString(row.delivered_at) ? { deliveredAt: toIsoString(row.delivered_at) } : {}),
    ...(toIsoString(row.picked_up_at) ? { pickedUpAt: toIsoString(row.picked_up_at) } : {}),
    ...(parseOptionalBigInt(row.cardcom_transaction_id) !== undefined
      ? { cardcomTransactionId: parseOptionalBigInt(row.cardcom_transaction_id) }
      : {}),
    ...(typeof row.cardcom_document_type === "string" && row.cardcom_document_type
      ? { cardcomDocumentType: row.cardcom_document_type }
      : {}),
    ...(parseOptionalBigInt(row.cardcom_document_number) !== undefined
      ? { cardcomDocumentNumber: parseOptionalBigInt(row.cardcom_document_number) }
      : {}),
    ...(row.purchase_email_status === "pending" ||
    row.purchase_email_status === "processing" ||
    row.purchase_email_status === "sent" ||
    row.purchase_email_status === "failed"
      ? { purchaseEmailStatus: row.purchase_email_status }
      : {}),
    ...(toIsoString(row.purchase_email_sent_at)
      ? { purchaseEmailSentAt: toIsoString(row.purchase_email_sent_at)! }
      : {}),
    ...(row.purchase_email_last_error
      ? { purchaseEmailLastError: row.purchase_email_last_error }
      : {}),
  };
}

export async function getPaymentAttemptById(
  id: string,
): Promise<SavedPaymentAttempt | null> {
  const trimmed = id.trim();
  if (!trimmed) return null;
  const rows = await sql`
    SELECT ${PAYMENT_ATTEMPT_ROW_SQL}
    FROM payment_attempts
    WHERE id = ${trimmed}::uuid
    LIMIT 1
  `;
  const row = (rows as PaymentAttemptRow[])[0];
  return row ? mapPaymentAttemptRow(row) : null;
}

export async function getPaymentAttemptByCheckoutSessionId(
  checkoutSessionId: string,
): Promise<SavedPaymentAttempt | null> {
  const sessionId = checkoutSessionId.trim();
  if (!sessionId) return null;
  const rows = await sql`
    SELECT ${PAYMENT_ATTEMPT_ROW_SQL}
    FROM payment_attempts
    WHERE checkout_session_id = ${sessionId}
    LIMIT 1
  `;
  const row = (rows as PaymentAttemptRow[])[0];
  return row ? mapPaymentAttemptRow(row) : null;
}

/** Insert a payment attempt row. */
export async function insertPaymentAttempt(attempt: SavedPaymentAttempt): Promise<void> {
  await sql`
    INSERT INTO payment_attempts (
      id,
      status,
      pos_spot_id,
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
    VALUES (
      ${attempt.id}::uuid,
      ${attempt.status},
      ${attempt.posSpotId}::uuid,
      ${attempt.offerId ?? null},
      ${attempt.productId},
      ${attempt.productName},
      ${attempt.fullName},
      ${attempt.customerEmail},
      ${attempt.phone},
      ${attempt.address},
      ${attempt.apartmentOrNotes},
      ${attempt.fulfillmentMethod},
      ${attempt.amount},
      ${attempt.snapshot ? JSON.stringify(attempt.snapshot) : null}::jsonb,
      ${attempt.checkoutSessionId ?? null},
      ${attempt.cardcomEnv ?? null},
      ${attempt.paymentResumeToken},
      ${attempt.paymentRetryLockAt ?? null}::timestamptz,
      ${attempt.expiresAt ?? null}::timestamptz,
      ${attempt.failureReason ?? null},
      ${attempt.finalizedOrderId ?? null}::uuid,
      ${attempt.cardcomTransactionId ?? null},
      ${attempt.createdAt}::timestamptz,
      ${attempt.updatedAt}::timestamptz
    )
  `;
}

/** Test/cleanup helper. */
export async function deletePaymentAttemptById(id: string): Promise<void> {
  const trimmed = id.trim();
  if (!trimmed) return;
  await sql`DELETE FROM payment_attempts WHERE id = ${trimmed}::uuid`;
}

export type AttachCheckoutSessionIdToAttemptResult =
  | { ok: true; attempt: SavedPaymentAttempt; alreadyAttached?: boolean }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_awaiting"
        | "already_set"
        | "duplicate_session"
        | "conflict";
    };

export async function attachCheckoutSessionIdToAttempt(
  attemptId: string,
  checkoutSessionId: string,
  options?: { cardcomEnv?: "test" | "production" },
): Promise<AttachCheckoutSessionIdToAttemptResult> {
  const trimmedId = attemptId.trim();
  const sessionId = checkoutSessionId.trim();
  const cardcomEnv = options?.cardcomEnv ?? "production";
  if (!trimmedId || !sessionId) return { ok: false, reason: "conflict" };

  try {
    const rows = await sql`
      UPDATE payment_attempts
      SET
        checkout_session_id = ${sessionId},
        cardcom_env = ${cardcomEnv},
        status = 'awaiting_payment',
        updated_at = now()
      WHERE id = ${trimmedId}::uuid
        AND status IN ('created', 'awaiting_payment')
        AND checkout_session_id IS NULL
      RETURNING ${PAYMENT_ATTEMPT_ROW_SQL}
    `;
    const row = (rows as PaymentAttemptRow[])[0];
    if (row) return { ok: true, attempt: mapPaymentAttemptRow(row) };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "duplicate_session" };
    }
    throw error;
  }

  const existing = await getPaymentAttemptById(trimmedId);
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.status !== "created" && existing.status !== "awaiting_payment") {
    return { ok: false, reason: "not_awaiting" };
  }
  if (existing.checkoutSessionId === sessionId) {
    return { ok: true, attempt: existing, alreadyAttached: true };
  }
  if (existing.checkoutSessionId) {
    return { ok: false, reason: "already_set" };
  }
  return { ok: false, reason: "conflict" };
}

/** Cancel/fail an attempt that never reached verified payment. */
export async function markPaymentAttemptTerminal(
  attemptId: string,
  status: "cancelled" | "failed",
  reason: string,
): Promise<SavedPaymentAttempt | null> {
  const trimmedId = attemptId.trim();
  const reasonTrim = reason.trim();
  if (!trimmedId || !reasonTrim) return null;

  const rows = await sql`
    UPDATE payment_attempts
    SET
      status = ${status},
      failure_reason = ${reasonTrim},
      payment_retry_lock_at = NULL,
      updated_at = now()
    WHERE id = ${trimmedId}::uuid
      AND status IN ('created', 'awaiting_payment')
    RETURNING ${PAYMENT_ATTEMPT_ROW_SQL}
  `;
  const row = (rows as PaymentAttemptRow[])[0];
  return row ? mapPaymentAttemptRow(row) : null;
}

export async function getAwaitingPaymentAttemptForResume(
  attemptId: string,
  resumeToken: string,
): Promise<SavedPaymentAttempt | null> {
  const trimmedId = attemptId.trim();
  const token = resumeToken.trim();
  if (!trimmedId || !token) return null;

  const attempt = await getPaymentAttemptById(trimmedId);
  if (!attempt) return null;
  if (attempt.status !== "awaiting_payment") return null;
  if (!paymentResumeTokensEqual(attempt.paymentResumeToken, token)) return null;
  return attempt;
}

export type ClaimPaymentAttemptRetryLockResult =
  | { ok: true; attempt: SavedPaymentAttempt }
  | {
      ok: false;
      reason: "not_found" | "not_awaiting" | "token_mismatch" | "busy" | "conflict";
      attempt?: SavedPaymentAttempt;
    };

export async function claimPaymentAttemptRetryLock(input: {
  attemptId: string;
  resumeToken: string;
}): Promise<ClaimPaymentAttemptRetryLockResult> {
  const attemptId = input.attemptId.trim();
  const resumeToken = input.resumeToken.trim();
  if (!attemptId || !resumeToken) return { ok: false, reason: "conflict" };

  const rows = await sql`
    UPDATE payment_attempts
    SET
      payment_retry_lock_at = now(),
      updated_at = now()
    WHERE id = ${attemptId}::uuid
      AND status = 'awaiting_payment'
      AND payment_resume_token = ${resumeToken}
      AND (
        payment_retry_lock_at IS NULL
        OR payment_retry_lock_at < (now() - interval '3 minutes')
      )
    RETURNING ${PAYMENT_ATTEMPT_ROW_SQL}
  `;
  const row = (rows as PaymentAttemptRow[])[0];
  if (row) return { ok: true, attempt: mapPaymentAttemptRow(row) };

  const existing = await getPaymentAttemptById(attemptId);
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.status !== "awaiting_payment") {
    return { ok: false, reason: "not_awaiting", attempt: existing };
  }
  if (!paymentResumeTokensEqual(existing.paymentResumeToken, resumeToken)) {
    return { ok: false, reason: "token_mismatch", attempt: existing };
  }
  return { ok: false, reason: "busy", attempt: existing };
}

export async function releasePaymentAttemptRetryLock(attemptId: string): Promise<void> {
  const trimmed = attemptId.trim();
  if (!trimmed) return;
  await sql`
    UPDATE payment_attempts
    SET
      payment_retry_lock_at = NULL,
      updated_at = now()
    WHERE id = ${trimmed}::uuid
      AND status = 'awaiting_payment'
  `;
}

export async function rotateCheckoutSessionIdForAttemptResume(input: {
  attemptId: string;
  resumeToken: string;
  newCheckoutSessionId: string;
  cardcomEnv: "test" | "production";
}): Promise<
  | { ok: true; attempt: SavedPaymentAttempt }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_awaiting"
        | "token_mismatch"
        | "duplicate_session"
        | "conflict";
    }
> {
  const attemptId = input.attemptId.trim();
  const resumeToken = input.resumeToken.trim();
  const sessionId = input.newCheckoutSessionId.trim();
  if (!attemptId || !resumeToken || !sessionId) {
    return { ok: false, reason: "conflict" };
  }

  try {
    const rows = await sql`
      UPDATE payment_attempts
      SET
        checkout_session_id = ${sessionId},
        cardcom_env = ${input.cardcomEnv},
        updated_at = now()
      WHERE id = ${attemptId}::uuid
        AND status = 'awaiting_payment'
        AND payment_resume_token = ${resumeToken}
      RETURNING ${PAYMENT_ATTEMPT_ROW_SQL}
    `;
    const row = (rows as PaymentAttemptRow[])[0];
    if (row) return { ok: true, attempt: mapPaymentAttemptRow(row) };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "duplicate_session" };
    }
    throw error;
  }

  const existing = await getPaymentAttemptById(attemptId);
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.status !== "awaiting_payment") {
    return { ok: false, reason: "not_awaiting" };
  }
  if (!paymentResumeTokensEqual(existing.paymentResumeToken, resumeToken)) {
    return { ok: false, reason: "token_mismatch" };
  }
  return { ok: false, reason: "conflict" };
}

/**
 * Late Cardcom success after local expiry/cancel/fail: retain evidence, no Order.
 */
export async function markPaymentAttemptNeedsReconciliation(input: {
  attemptId: string;
  checkoutSessionId: string;
  cardcomTransactionId?: number;
  reason: string;
}): Promise<SavedPaymentAttempt | null> {
  const attemptId = input.attemptId.trim();
  const sessionId = input.checkoutSessionId.trim();
  const reason = input.reason.trim() || "late_cardcom_success";
  if (!attemptId || !sessionId) return null;

  const txId =
    typeof input.cardcomTransactionId === "number" &&
    Number.isFinite(input.cardcomTransactionId)
      ? Math.trunc(input.cardcomTransactionId)
      : null;

  const rows = await sql`
    UPDATE payment_attempts
    SET
      status = 'needs_reconciliation',
      failure_reason = ${reason},
      cardcom_transaction_id = COALESCE(
        ${txId}::bigint,
        cardcom_transaction_id
      ),
      payment_retry_lock_at = NULL,
      updated_at = now()
    WHERE id = ${attemptId}::uuid
      AND checkout_session_id = ${sessionId}
      AND status IN ('expired', 'cancelled', 'failed', 'needs_reconciliation')
    RETURNING ${PAYMENT_ATTEMPT_ROW_SQL}
  `;
  const row = (rows as PaymentAttemptRow[])[0];
  return row ? mapPaymentAttemptRow(row) : null;
}

export type FinalizeVerifiedPaymentAttemptResult =
  | {
      ok: true;
      order: SavedOrder;
      attempt: SavedPaymentAttempt;
      finalized: boolean;
      posStatus: string;
    }
  | { ok: false; reason: "ineligible" | "conflict" };

/**
 * Atomic: awaiting attempt + owned held POS → insert Order + POS sold/available + attempt finalized.
 * Flowers catalog items return POS to available; plants remain sold.
 * Single SQL statement (Postgres CTE). Email/document run after commit by caller.
 */
export async function finalizeVerifiedPaymentAttemptAtomic(input: {
  attemptId: string;
  checkoutSessionId: string;
  posSpotId: string;
  fulfillmentMethod: "delivery" | "pickup";
  cardcomTransactionId?: number;
  /** Partner address resolved at finalize (not stored on attempt columns). */
  partnerLocationAddress?: string | null;
}): Promise<FinalizeVerifiedPaymentAttemptResult> {
  const attemptId = input.attemptId.trim();
  const checkoutSessionId = input.checkoutSessionId.trim();
  const posSpotId = input.posSpotId.trim();
  if (!attemptId || !checkoutSessionId || !posSpotId) {
    return { ok: false, reason: "ineligible" };
  }

  const isPickup = input.fulfillmentMethod === "pickup";
  const nextStatus = isPickup ? "picked_up" : "sold";
  const pickedUpAt = isPickup ? new Date().toISOString() : null;
  const cardcomTransactionId =
    typeof input.cardcomTransactionId === "number" &&
    Number.isFinite(input.cardcomTransactionId)
      ? Math.trunc(input.cardcomTransactionId)
      : null;
  const partnerLocationAddress = input.partnerLocationAddress?.trim() || null;

  const rows = await sql`
    WITH eligible AS (
      SELECT
        a.id AS attempt_id,
        a.pos_spot_id,
        a.offer_id,
        a.product_id,
        a.product_name,
        a.full_name,
        a.customer_email,
        a.phone,
        a.address,
        a.apartment_or_notes,
        a.fulfillment_method,
        a.amount,
        a.snapshot,
        a.checkout_session_id,
        a.cardcom_env,
        a.payment_resume_token,
        a.created_at,
        COALESCE(
          a.snapshot->>'partnerLocationId',
          NULL
        ) AS partner_location_id,
        COALESCE(
          a.snapshot->>'partnerLocationName',
          NULL
        ) AS partner_location_name
      FROM payment_attempts a
      INNER JOIN pos_spots p ON p.id = a.pos_spot_id
      WHERE a.id = ${attemptId}::uuid
        AND a.status = 'awaiting_payment'
        AND a.checkout_session_id = ${checkoutSessionId}
        AND a.pos_spot_id = ${posSpotId}::uuid
        AND p.status = 'held_for_payment'
        AND p.payment_hold_attempt_id = a.id
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
        picked_up_at,
        snapshot,
        created_at,
        cardcom_transaction_id,
        purchase_email_status
      )
      SELECT
        gen_random_uuid(),
        e.checkout_session_id,
        e.cardcom_env,
        e.payment_resume_token,
        e.pos_spot_id,
        e.offer_id,
        e.product_id,
        e.product_name,
        e.partner_location_id,
        e.partner_location_name,
        ${partnerLocationAddress},
        e.amount,
        e.full_name,
        e.customer_email,
        e.phone,
        e.address,
        e.apartment_or_notes,
        e.fulfillment_method,
        ${nextStatus},
        'online',
        ${pickedUpAt}::timestamptz,
        e.snapshot,
        now(),
        ${cardcomTransactionId}::bigint,
        'pending'
      FROM eligible e
      RETURNING
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
        cancelled_at,
        cancelled_by,
        cancellation_reason,
        delivered_at,
        picked_up_at,
        snapshot,
        created_at,
        cardcom_transaction_id,
        cardcom_document_type,
        cardcom_document_number,
        purchase_email_status,
        purchase_email_sent_at,
        purchase_email_last_error
    ),
    pos_upd AS (
      UPDATE pos_spots p
      SET
        status = CASE
          WHEN COALESCE(
            (
              SELECT pl.inventory_type
              FROM plants pl
              WHERE pl.id = e.product_id
            ),
            'plants'
          ) = 'flowers' THEN 'available'
          ELSE 'sold'
        END,
        payment_hold_started_at = NULL,
        payment_hold_attempt_id = NULL
      FROM eligible e
      WHERE p.id = e.pos_spot_id
        AND p.status = 'held_for_payment'
        AND p.payment_hold_attempt_id = e.attempt_id
      RETURNING p.id, p.status
    ),
    attempt_upd AS (
      UPDATE payment_attempts a
      SET
        status = 'finalized',
        finalized_order_id = o.order_id,
        cardcom_transaction_id = COALESCE(
          ${cardcomTransactionId}::bigint,
          a.cardcom_transaction_id
        ),
        payment_retry_lock_at = NULL,
        updated_at = now()
      FROM eligible e
      INNER JOIN order_ins o ON true
      WHERE a.id = e.attempt_id
        AND a.status = 'awaiting_payment'
      -- Qualify columns: UPDATE…FROM makes bare pos_spot_id ambiguous vs eligible.
      RETURNING a.id
    )
    SELECT
      o.order_id,
      o.checkout_session_id,
      o.cardcom_env,
      o.payment_resume_token,
      o.pos_spot_id,
      o.offer_id,
      o.product_id,
      o.product_name,
      o.partner_location_id,
      o.partner_location_name,
      o.partner_location_address,
      o.price,
      o.full_name,
      o.customer_email,
      o.phone,
      o.address,
      o.apartment_or_notes,
      o.fulfillment_method,
      o.order_status,
      o.source,
      o.cancelled_at,
      o.cancelled_by,
      o.cancellation_reason,
      o.delivered_at,
      o.picked_up_at,
      o.snapshot,
      o.created_at,
      o.cardcom_transaction_id,
      o.cardcom_document_type,
      o.cardcom_document_number,
      o.purchase_email_status,
      o.purchase_email_sent_at,
      o.purchase_email_last_error,
      (SELECT id FROM pos_upd LIMIT 1) AS finalized_pos_spot_id,
      (SELECT status FROM pos_upd LIMIT 1) AS pos_status,
      (SELECT id FROM attempt_upd LIMIT 1) AS finalized_attempt_id
    FROM order_ins o
  `;

  const row = (
    rows as (OrderRow & {
      finalized_pos_spot_id: string | null;
      finalized_attempt_id: string | null;
      pos_status: string | null;
    })[]
  )[0];

  if (!row || !row.finalized_pos_spot_id || !row.finalized_attempt_id) {
    return { ok: false, reason: "conflict" };
  }

  const attempt = await getPaymentAttemptById(attemptId);
  if (!attempt || attempt.status !== "finalized") {
    return { ok: false, reason: "conflict" };
  }

  return {
    ok: true,
    order: mapOrderRowLite(row),
    attempt,
    finalized: true,
    posStatus: row.pos_status === "available" ? "available" : "sold",
  };
}
