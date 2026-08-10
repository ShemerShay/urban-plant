/**
 * Order persistence backed by Neon Postgres.
 */

import "server-only";

import { sql } from "@/lib/db";
import { paymentResumeTokensEqual } from "@/lib/paymentResume";
import { parseNumeric, toIsoString } from "@/lib/storageUtils";

import type {
  FulfillmentMethod,
  OrderSnapshot,
  PurchaseEmailStatus,
  SavedOrder,
} from "./orderTypes";
import type { OrderStatus } from "./status";
import { isOrderStatus } from "./status";

function isPurchaseEmailStatus(value: unknown): value is PurchaseEmailStatus {
  return (
    value === "pending" ||
    value === "processing" ||
    value === "sent" ||
    value === "failed"
  );
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

/**
 * Map DB / legacy status strings to OrderStatus.
 * pending_payment must remain pending_payment (never coerce to sold).
 */
export function normalizeLegacyOrderStatus(
  raw: unknown,
  source: "orderStatus" | "deliveryStatus",
): OrderStatus {
  if (isOrderStatus(raw)) return raw;
  // Legacy deliveryStatus / older rows — not Cardcom pending_payment.
  if (source === "deliveryStatus" && (raw === "available" || raw === "pending")) {
    return "sold";
  }
  if (raw === "available" || raw === "pending") {
    return "sold";
  }
  return "sold";
}

function normalizeSnapshot(value: unknown): OrderSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const o = value as Record<string, unknown>;
  const productId = typeof o.productId === "string" ? o.productId : "";
  const productName = typeof o.productName === "string" ? o.productName : "";
  const productDescription = typeof o.productDescription === "string" ? o.productDescription : "";
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
    ...(typeof o.productFamily === "string" && o.productFamily ? { productFamily: o.productFamily } : {}),
    ...(typeof o.productImage === "string" && o.productImage ? { productImage: o.productImage } : {}),
    productDescription,
    offerId,
    consumerPrice,
    ...(typeof o.supplierPrice === "number" && Number.isFinite(o.supplierPrice)
      ? { supplierPrice: o.supplierPrice }
      : {}),
    ...(typeof o.supplierName === "string" && o.supplierName ? { supplierName: o.supplierName } : {}),
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

function mapOrderRow(row: OrderRow): SavedOrder {
  const orderId = String(row.order_id);
  const fulfillmentMethod: FulfillmentMethod =
    row.fulfillment_method === "pickup" ? "pickup" : "delivery";
  const orderStatus = normalizeLegacyOrderStatus(row.order_status, "orderStatus");
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

  return {
    id: orderId,
    orderId,
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
    ...(typeof row.cardcom_document_type === "string" && row.cardcom_document_type.trim()
      ? { cardcomDocumentType: row.cardcom_document_type.trim() }
      : {}),
    ...(parseOptionalBigInt(row.cardcom_document_number) !== undefined
      ? { cardcomDocumentNumber: parseOptionalBigInt(row.cardcom_document_number) }
      : {}),
    ...(isPurchaseEmailStatus(row.purchase_email_status)
      ? { purchaseEmailStatus: row.purchase_email_status }
      : {}),
    ...(toIsoString(row.purchase_email_sent_at)
      ? { purchaseEmailSentAt: toIsoString(row.purchase_email_sent_at) }
      : {}),
    ...(typeof row.purchase_email_last_error === "string" &&
    row.purchase_email_last_error.trim()
      ? { purchaseEmailLastError: row.purchase_email_last_error.trim() }
      : {}),
  };
}

async function insertOrder(order: SavedOrder): Promise<void> {
  await sql`
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
      cancelled_at,
      cancelled_by,
      cancellation_reason,
      delivered_at,
      picked_up_at,
      snapshot,
      created_at
    )
    VALUES (
      ${order.orderId}::uuid,
      ${order.checkoutSessionId ?? null},
      ${order.cardcomEnv ?? null},
      ${order.paymentResumeToken ?? null},
      ${order.posSpotId ?? null}::uuid,
      ${order.offerId ?? null},
      ${order.plantId},
      ${order.plantName},
      ${order.locationId},
      ${order.locationName},
      ${order.locationAddress},
      ${order.price},
      ${order.fullName},
      ${order.customerEmail ?? null},
      ${order.phone},
      ${order.address},
      ${order.apartmentOrNotes},
      ${order.fulfillmentMethod},
      ${order.orderStatus},
      ${order.source ?? null},
      ${order.cancelledAt ?? null}::timestamptz,
      ${order.cancelledBy ?? null},
      ${order.cancellationReason ?? null},
      ${order.deliveredAt ?? null}::timestamptz,
      ${order.pickedUpAt ?? null}::timestamptz,
      ${order.snapshot ? JSON.stringify(order.snapshot) : null}::jsonb,
      ${order.createdAt}::timestamptz
    )
  `;
}

export async function readOrders(): Promise<SavedOrder[]> {
  const rows = await sql`
    SELECT
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
      created_at
    FROM orders
    ORDER BY created_at DESC
  `;
  return (rows as OrderRow[]).map(mapOrderRow);
}

export async function saveOrders(orders: SavedOrder[]): Promise<void> {
  await sql`DELETE FROM orders`;
  for (const order of orders) {
    await insertOrder(order);
  }
}

export async function appendOrder(order: SavedOrder): Promise<void> {
  await insertOrder(order);
}

export async function patchOrderById(
  orderId: string,
  patch: Partial<
    Pick<
      SavedOrder,
      | "orderStatus"
      | "deliveredAt"
      | "pickedUpAt"
      | "cancelledAt"
      | "cancelledBy"
      | "cancellationReason"
    >
  >,
): Promise<SavedOrder | null> {
  const existing = await getOrderById(orderId);
  if (!existing) return null;

  const updated: SavedOrder = {
    ...existing,
    ...patch,
  };

  await replaceOrder(updated);
  return updated;
}

export async function getOrderById(orderId: string): Promise<SavedOrder | null> {
  const rows = await sql`
    SELECT
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
    FROM orders
    WHERE order_id = ${orderId}::uuid
    LIMIT 1
  `;
  const row = (rows as OrderRow[])[0];
  return row ? mapOrderRow(row) : null;
}

export async function replaceOrder(order: SavedOrder): Promise<SavedOrder | null> {
  const rows = await sql`
    UPDATE orders
    SET
      checkout_session_id = ${order.checkoutSessionId ?? null},
      cardcom_env = ${order.cardcomEnv ?? null},
      payment_resume_token = ${order.paymentResumeToken ?? null},
      pos_spot_id = ${order.posSpotId ?? null}::uuid,
      offer_id = ${order.offerId ?? null},
      product_id = ${order.plantId},
      product_name = ${order.plantName},
      partner_location_id = ${order.locationId},
      partner_location_name = ${order.locationName},
      partner_location_address = ${order.locationAddress},
      price = ${order.price},
      full_name = ${order.fullName},
      customer_email = ${order.customerEmail ?? null},
      phone = ${order.phone},
      address = ${order.address},
      apartment_or_notes = ${order.apartmentOrNotes},
      fulfillment_method = ${order.fulfillmentMethod},
      order_status = ${order.orderStatus},
      source = ${order.source ?? null},
      cancelled_at = ${order.cancelledAt ?? null}::timestamptz,
      cancelled_by = ${order.cancelledBy ?? null},
      cancellation_reason = ${order.cancellationReason ?? null},
      delivered_at = ${order.deliveredAt ?? null}::timestamptz,
      picked_up_at = ${order.pickedUpAt ?? null}::timestamptz,
      snapshot = ${order.snapshot ? JSON.stringify(order.snapshot) : null}::jsonb,
      created_at = ${order.createdAt}::timestamptz
    WHERE order_id = ${order.orderId}::uuid
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
      created_at
  `;
  const row = (rows as OrderRow[])[0];
  return row ? mapOrderRow(row) : null;
}

export type AttachCheckoutSessionIdResult =
  | { ok: true; order: SavedOrder; alreadyAttached: boolean }
  | {
      ok: false;
      reason: "not_found" | "not_pending" | "already_set" | "duplicate_session" | "conflict";
    };

/**
 * Attach Cardcom LowProfileId to checkout_session_id on a pending_payment order.
 * - Succeeds when checkout_session_id IS NULL (new attach).
 * - Idempotent when the same LowProfileId is already on this order.
 * - Fails when a different LowProfileId is already set (no overwrite).
 * - Fails when the LowProfileId is already used by another order (unique index).
 */
export async function attachCheckoutSessionIdToPendingOrder(
  orderId: string,
  checkoutSessionId: string,
  options?: { cardcomEnv?: "test" | "production" },
): Promise<AttachCheckoutSessionIdResult> {
  const trimmedId = orderId.trim();
  const sessionId = checkoutSessionId.trim();
  const cardcomEnv = options?.cardcomEnv ?? "production";
  if (!trimmedId || !sessionId) {
    return { ok: false, reason: "conflict" };
  }

  try {
    const rows = await sql`
      UPDATE orders
      SET
        checkout_session_id = ${sessionId},
        cardcom_env = ${cardcomEnv}
      WHERE order_id = ${trimmedId}::uuid
        AND order_status = 'pending_payment'
        AND checkout_session_id IS NULL
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
        created_at
    `;
    const row = (rows as OrderRow[])[0];
    if (row) {
      return { ok: true, order: mapOrderRow(row), alreadyAttached: false };
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "duplicate_session" };
    }
    throw error;
  }

  const existing = await getOrderById(trimmedId);
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.orderStatus !== "pending_payment") {
    return { ok: false, reason: "not_pending" };
  }
  if (existing.checkoutSessionId === sessionId) {
    // Idempotent: same LowProfileId already stored on this pending order.
    return { ok: true, order: existing, alreadyAttached: true };
  }
  if (existing.checkoutSessionId) {
    return { ok: false, reason: "already_set" };
  }
  return { ok: false, reason: "conflict" };
}

/**
 * Cancel only while order_status is still pending_payment.
 * Returns null if the order is missing or no longer pending.
 */
export async function cancelPendingPaymentOrder(
  orderId: string,
  reason: string,
): Promise<SavedOrder | null> {
  const trimmedId = orderId.trim();
  const reasonTrim = reason.trim();
  if (!trimmedId || !reasonTrim) return null;

  const cancelledAt = new Date().toISOString();
  const rows = await sql`
    UPDATE orders
    SET
      order_status = 'cancelled',
      cancelled_at = ${cancelledAt}::timestamptz,
      cancelled_by = 'system',
      cancellation_reason = ${reasonTrim},
      delivered_at = NULL,
      picked_up_at = NULL,
      payment_retry_lock_at = NULL
    WHERE order_id = ${trimmedId}::uuid
      AND order_status = 'pending_payment'
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
  `;
  const row = (rows as OrderRow[])[0];
  return row ? mapOrderRow(row) : null;
}

export type AdminCancelPendingOrderResult =
  | { ok: true; order: SavedOrder; releasedPos: boolean }
  | {
      ok: false;
      reason: "not_found" | "not_cancellable" | "conflict";
      order?: SavedOrder;
    };

/**
 * Admin cancel for unpaid pending_payment only.
 * Atomic: fails if webhook already finalized (sold/picked_up/delivered).
 * Releases POS only when still held_for_payment (never if sold).
 */
export async function adminCancelPendingPaymentOrder(input: {
  orderId: string;
  cancellationReason: string;
}): Promise<AdminCancelPendingOrderResult> {
  const orderId = input.orderId.trim();
  const reason =
    input.cancellationReason.trim() || "Cancelled by admin";
  if (!orderId) return { ok: false, reason: "not_found" };

  const cancelledAt = new Date().toISOString();
  const rows = await sql`
    WITH cancelled AS (
      UPDATE orders
      SET
        order_status = 'cancelled',
        cancelled_at = ${cancelledAt}::timestamptz,
        cancelled_by = 'admin',
        cancellation_reason = ${reason},
        delivered_at = NULL,
        picked_up_at = NULL,
        payment_retry_lock_at = NULL
      WHERE order_id = ${orderId}::uuid
        AND order_status = 'pending_payment'
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
    released AS (
      UPDATE pos_spots p
      SET
        status = 'available',
        payment_hold_started_at = NULL
      FROM cancelled c
      WHERE p.id = c.pos_spot_id
        AND p.status = 'held_for_payment'
      RETURNING p.id
    )
    SELECT
      c.*,
      (SELECT id FROM released LIMIT 1) AS released_pos_id
    FROM cancelled c
  `;

  const row = (
    rows as (OrderRow & { released_pos_id: string | null })[]
  )[0];
  if (row) {
    return {
      ok: true,
      order: mapOrderRow(row),
      releasedPos: Boolean(row.released_pos_id),
    };
  }

  const existing = await getOrderById(orderId);
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.orderStatus !== "pending_payment") {
    return { ok: false, reason: "not_cancellable", order: existing };
  }
  return { ok: false, reason: "conflict", order: existing };
}

/** Stale retry lock older than 3 minutes may be reclaimed (crash safety). */
export const PAYMENT_RETRY_LOCK_TTL_MS = 3 * 60 * 1000;

export type ClaimPaymentRetryLockResult =
  | { ok: true; order: SavedOrder }
  | {
      ok: false;
      reason: "not_found" | "not_pending" | "busy" | "token_mismatch" | "conflict";
      order?: SavedOrder;
    };

/**
 * Atomically claim the right to call Cardcom LowProfile/Create for a retry.
 * Only one concurrent retry may hold the lock.
 */
export async function claimPaymentRetryLock(input: {
  orderId: string;
  resumeToken: string;
}): Promise<ClaimPaymentRetryLockResult> {
  const orderId = input.orderId.trim();
  const resumeToken = input.resumeToken.trim();
  if (!orderId || !resumeToken) return { ok: false, reason: "conflict" };

  const rows = await sql`
    UPDATE orders
    SET payment_retry_lock_at = now()
    WHERE order_id = ${orderId}::uuid
      AND order_status = 'pending_payment'
      AND payment_resume_token = ${resumeToken}
      AND (
        payment_retry_lock_at IS NULL
        OR payment_retry_lock_at < (now() - interval '3 minutes')
      )
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
  `;
  const row = (rows as OrderRow[])[0];
  if (row) return { ok: true, order: mapOrderRow(row) };

  const existing = await getOrderById(orderId);
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.orderStatus !== "pending_payment") {
    return { ok: false, reason: "not_pending", order: existing };
  }
  if (
    !existing.paymentResumeToken ||
    existing.paymentResumeToken !== resumeToken
  ) {
    return { ok: false, reason: "token_mismatch", order: existing };
  }
  return { ok: false, reason: "busy", order: existing };
}

export async function releasePaymentRetryLock(orderId: string): Promise<void> {
  const trimmed = orderId.trim();
  if (!trimmed) return;
  await sql`
    UPDATE orders
    SET payment_retry_lock_at = NULL
    WHERE order_id = ${trimmed}::uuid
      AND order_status = 'pending_payment'
  `;
}

export async function getOrderByCheckoutSessionId(
  checkoutSessionId: string,
): Promise<SavedOrder | null> {
  const sessionId = checkoutSessionId.trim();
  if (!sessionId) return null;

  const rows = await sql`
    SELECT
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
    FROM orders
    WHERE checkout_session_id = ${sessionId}
    LIMIT 1
  `;
  const row = (rows as OrderRow[])[0];
  return row ? mapOrderRow(row) : null;
}

export type FinalizeVerifiedPendingPaymentResult =
  | {
      ok: true;
      order: SavedOrder;
      finalized: boolean;
    }
  | { ok: false; reason: "ineligible" | "conflict" };

/**
 * Atomically finalize a verified pending payment on the SAME order row + its POS.
 * Single SQL statement (Postgres atomic): both updates happen together or not at all.
 *
 * Delivery: pending_payment → sold
 * Pickup: pending_payment → picked_up (+ picked_up_at)
 * POS: held_for_payment → sold
 *
 * Also persists verified Cardcom TranzactionId and sets purchase_email_status = pending
 * so post-payment document/email can be claimed without rolling back payment.
 */
export async function finalizeVerifiedPendingPaymentAtomic(input: {
  orderId: string;
  checkoutSessionId: string;
  posSpotId: string;
  fulfillmentMethod: "delivery" | "pickup";
  /** Trusted GetLpResult TranzactionInfo.TranzactionId */
  cardcomTransactionId?: number;
}): Promise<FinalizeVerifiedPendingPaymentResult> {
  const orderId = input.orderId.trim();
  const checkoutSessionId = input.checkoutSessionId.trim();
  const posSpotId = input.posSpotId.trim();
  if (!orderId || !checkoutSessionId || !posSpotId) {
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

  const rows = await sql`
    WITH eligible AS (
      SELECT
        o.order_id,
        o.pos_spot_id
      FROM orders o
      INNER JOIN pos_spots p ON p.id = o.pos_spot_id
      WHERE o.order_id = ${orderId}::uuid
        AND o.order_status = 'pending_payment'
        AND o.checkout_session_id = ${checkoutSessionId}
        AND o.pos_spot_id = ${posSpotId}::uuid
        AND p.status = 'held_for_payment'
    ),
    order_upd AS (
      UPDATE orders o
      SET
        order_status = ${nextStatus},
        picked_up_at = ${pickedUpAt}::timestamptz,
        cancelled_at = NULL,
        cancelled_by = NULL,
        cancellation_reason = NULL,
        cardcom_transaction_id = COALESCE(
          ${cardcomTransactionId}::bigint,
          o.cardcom_transaction_id
        ),
        purchase_email_status = COALESCE(o.purchase_email_status, 'pending')
      FROM eligible e
      WHERE o.order_id = e.order_id
      RETURNING
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
        o.purchase_email_last_error
    ),
    pos_upd AS (
      UPDATE pos_spots p
      SET
        status = 'sold',
        payment_hold_started_at = NULL,
        payment_hold_attempt_id = NULL
      FROM eligible e
      WHERE p.id = e.pos_spot_id
      RETURNING p.id
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
      (SELECT id FROM pos_upd LIMIT 1) AS finalized_pos_spot_id
    FROM order_upd o
  `;

  const row = (rows as (OrderRow & { finalized_pos_spot_id: string | null })[])[0];
  if (!row || !row.finalized_pos_spot_id) {
    return { ok: false, reason: "conflict" };
  }

  return {
    ok: true,
    order: mapOrderRow(row),
    finalized: true,
  };
}

/**
 * Load a pending_payment order when orderId + resume token match (holder proof).
 * Does not mutate. Returns null when missing, not pending, or token mismatch.
 */
export async function getPendingOrderForPaymentResume(
  orderId: string,
  resumeToken: string,
): Promise<SavedOrder | null> {
  const trimmedId = orderId.trim();
  const token = resumeToken.trim();
  if (!trimmedId || !token) return null;

  const order = await getOrderById(trimmedId);
  if (!order) return null;
  if (order.orderStatus !== "pending_payment") return null;
  if (!order.paymentResumeToken) return null;
  if (!paymentResumeTokensEqual(order.paymentResumeToken, token)) return null;
  return order;
}

/**
 * Replace checkout_session_id on a pending order after a failed Cardcom attempt.
 * Requires matching payment_resume_token. Used for safe retry (new LowProfileId).
 */
export async function rotateCheckoutSessionIdForResume(input: {
  orderId: string;
  resumeToken: string;
  newCheckoutSessionId: string;
  cardcomEnv: "test" | "production";
}): Promise<
  | { ok: true; order: SavedOrder }
  | { ok: false; reason: "not_found" | "not_pending" | "token_mismatch" | "duplicate_session" | "conflict" }
> {
  const orderId = input.orderId.trim();
  const resumeToken = input.resumeToken.trim();
  const sessionId = input.newCheckoutSessionId.trim();
  if (!orderId || !resumeToken || !sessionId) {
    return { ok: false, reason: "conflict" };
  }

  try {
    const rows = await sql`
      UPDATE orders
      SET
        checkout_session_id = ${sessionId},
        cardcom_env = ${input.cardcomEnv}
      WHERE order_id = ${orderId}::uuid
        AND order_status = 'pending_payment'
        AND payment_resume_token = ${resumeToken}
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
        created_at
    `;
    const row = (rows as OrderRow[])[0];
    if (row) {
      return { ok: true, order: mapOrderRow(row) };
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "duplicate_session" };
    }
    throw error;
  }

  const existing = await getOrderById(orderId);
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.orderStatus !== "pending_payment") {
    return { ok: false, reason: "not_pending" };
  }
  if (
    !existing.paymentResumeToken ||
    existing.paymentResumeToken !== resumeToken
  ) {
    return { ok: false, reason: "token_mismatch" };
  }
  return { ok: false, reason: "conflict" };
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

export type ClaimPurchaseEmailProcessingResult =
  | { ok: true; order: SavedOrder }
  | {
      ok: false;
      reason: "not_found" | "already_sent" | "busy" | "ineligible";
      order?: SavedOrder;
    };

/**
 * Atomically claim post-payment document/email processing.
 * Only one concurrent caller may move pending|failed → processing.
 */
export async function claimPurchaseEmailProcessing(
  orderId: string,
): Promise<ClaimPurchaseEmailProcessingResult> {
  const trimmedId = orderId.trim();
  if (!trimmedId) return { ok: false, reason: "ineligible" };

  const rows = await sql`
    UPDATE orders
    SET
      purchase_email_status = 'processing',
      purchase_email_last_error = NULL
    WHERE order_id = ${trimmedId}::uuid
      AND purchase_email_sent_at IS NULL
      AND purchase_email_status IN ('pending', 'failed')
      AND order_status IN ('sold', 'picked_up', 'delivered')
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
  `;
  const row = (rows as OrderRow[])[0];
  if (row) {
    return { ok: true, order: mapOrderRow(row) };
  }

  const existing = await getOrderById(trimmedId);
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.purchaseEmailSentAt || existing.purchaseEmailStatus === "sent") {
    return { ok: false, reason: "already_sent", order: existing };
  }
  if (existing.purchaseEmailStatus === "processing") {
    return { ok: false, reason: "busy", order: existing };
  }
  return { ok: false, reason: "ineligible", order: existing };
}

export async function saveCardcomDocumentOnOrder(input: {
  orderId: string;
  documentType: string;
  documentNumber: number;
}): Promise<SavedOrder | null> {
  const orderId = input.orderId.trim();
  const documentType = input.documentType.trim();
  if (!orderId || !documentType || !Number.isFinite(input.documentNumber)) {
    return null;
  }

  const rows = await sql`
    UPDATE orders
    SET
      cardcom_document_type = ${documentType},
      cardcom_document_number = ${Math.trunc(input.documentNumber)}::bigint
    WHERE order_id = ${orderId}::uuid
      AND purchase_email_status = 'processing'
      AND purchase_email_sent_at IS NULL
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
  `;
  const row = (rows as OrderRow[])[0];
  return row ? mapOrderRow(row) : null;
}

export async function markPurchaseEmailSent(orderId: string): Promise<SavedOrder | null> {
  const trimmedId = orderId.trim();
  if (!trimmedId) return null;
  const sentAt = new Date().toISOString();

  const rows = await sql`
    UPDATE orders
    SET
      purchase_email_status = 'sent',
      purchase_email_sent_at = ${sentAt}::timestamptz,
      purchase_email_last_error = NULL
    WHERE order_id = ${trimmedId}::uuid
      AND purchase_email_status = 'processing'
      AND purchase_email_sent_at IS NULL
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
  `;
  const row = (rows as OrderRow[])[0];
  return row ? mapOrderRow(row) : null;
}

export async function markPurchaseEmailFailed(
  orderId: string,
  errorMessage: string,
): Promise<SavedOrder | null> {
  const trimmedId = orderId.trim();
  if (!trimmedId) return null;
  const safe =
    errorMessage.trim().slice(0, 500) || "Document or email processing failed";

  const rows = await sql`
    UPDATE orders
    SET
      purchase_email_status = 'failed',
      purchase_email_last_error = ${safe}
    WHERE order_id = ${trimmedId}::uuid
      AND purchase_email_sent_at IS NULL
      AND purchase_email_status = 'processing'
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
  `;
  const row = (rows as OrderRow[])[0];
  return row ? mapOrderRow(row) : null;
}

/**
 * Ensure paid Cardcom orders that skipped pending (legacy) can still be claimed.
 * Sets purchase_email_status = pending when null and paid + has transaction id.
 */
export async function ensurePurchaseEmailPending(
  orderId: string,
): Promise<SavedOrder | null> {
  const trimmedId = orderId.trim();
  if (!trimmedId) return null;

  const rows = await sql`
    UPDATE orders
    SET purchase_email_status = 'pending'
    WHERE order_id = ${trimmedId}::uuid
      AND purchase_email_sent_at IS NULL
      AND purchase_email_status IS NULL
      AND cardcom_transaction_id IS NOT NULL
      AND order_status IN ('sold', 'picked_up', 'delivered')
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
  `;
  const row = (rows as OrderRow[])[0];
  return row ? mapOrderRow(row) : getOrderById(trimmedId);
}
