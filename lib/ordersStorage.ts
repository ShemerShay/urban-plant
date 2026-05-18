/**
 * Order persistence backed by Neon Postgres.
 */

import { sql } from "@/lib/db";
import { parseNumeric, toIsoString } from "@/lib/storageUtils";

import type { FulfillmentMethod, OrderSnapshot, SavedOrder } from "./orderTypes";
import type { OrderStatus } from "./status";
import { isOrderStatus } from "./status";

function normalizeLegacyOrderStatus(
  raw: unknown,
  source: "orderStatus" | "deliveryStatus",
): OrderStatus {
  if (isOrderStatus(raw)) return raw;
  if (
    (source === "deliveryStatus" && (raw === "available" || raw === "pending")) ||
    raw === "available" ||
    raw === "pending_payment"
  ) {
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

  const careRaw = o.care && typeof o.care === "object" ? (o.care as Record<string, unknown>) : {};
  const careInstructions = Array.isArray(careRaw.careInstructions)
    ? careRaw.careInstructions.filter((x): x is string => typeof x === "string")
    : undefined;
  const averageSize =
    careRaw.averageSize === "small" || careRaw.averageSize === "medium" || careRaw.averageSize === "large"
      ? careRaw.averageSize
      : undefined;

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
    care: {
      ...(typeof careRaw.light === "string" && careRaw.light ? { light: careRaw.light } : {}),
      ...(typeof careRaw.wateringDays === "string" && careRaw.wateringDays
        ? { wateringDays: careRaw.wateringDays }
        : {}),
      ...(averageSize ? { averageSize } : {}),
      ...(typeof careRaw.maintenanceConditions === "string" && careRaw.maintenanceConditions
        ? { maintenanceConditions: careRaw.maintenanceConditions }
        : {}),
      ...(careInstructions && careInstructions.length > 0 ? { careInstructions } : {}),
    },
  };
}

type OrderRow = {
  order_id: string;
  checkout_session_id: string | null;
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
  };
}

async function insertOrder(order: SavedOrder): Promise<void> {
  await sql`
    INSERT INTO orders (
      order_id,
      checkout_session_id,
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
      ${order.posSpotId ?? null},
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

async function getOrderById(orderId: string): Promise<SavedOrder | null> {
  const rows = await sql`
    SELECT
      order_id,
      checkout_session_id,
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
      pos_spot_id = ${order.posSpotId ?? null},
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
