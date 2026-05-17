/**
 * Local JSON order management is only for prototype/testing and should be replaced
 * with a real database before production.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import type { FulfillmentMethod, OrderSnapshot, SavedOrder } from "./orderTypes";
import type { OrderStatus } from "./status";
import { isOrderStatus } from "./status";

const ORDERS_FILE = path.join(process.cwd(), "data", "orders.json");

function normalizeLegacyOrderStatus(raw: unknown, source: "orderStatus" | "deliveryStatus"): OrderStatus {
  if (isOrderStatus(raw)) return raw;
  /**
   * Legacy `deliveryStatus` only: "available"/"pending" meant order placed, awaiting fulfillment.
   * Legacy `orderStatus: "available"` is no longer an Order state; preserve the order as sold.
   */
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
    ...(typeof o.partnerLocationId === "string" && o.partnerLocationId ? { partnerLocationId: o.partnerLocationId } : {}),
    ...(typeof o.partnerLocationName === "string" && o.partnerLocationName ? { partnerLocationName: o.partnerLocationName } : {}),
    ...(typeof o.posSpotId === "string" && o.posSpotId ? { posSpotId: o.posSpotId } : {}),
    ...(typeof o.posSpotDescription === "string" && o.posSpotDescription ? { posSpotDescription: o.posSpotDescription } : {}),
    ...(typeof o.spotSlug === "string" && o.spotSlug
      ? { spotSlug: o.spotSlug }
      : typeof o.qrSlug === "string" && o.qrSlug
        ? { spotSlug: o.qrSlug }
        : {}),
    fulfillmentType,
    care: {
      ...(typeof careRaw.light === "string" && careRaw.light ? { light: careRaw.light } : {}),
      ...(typeof careRaw.wateringDays === "string" && careRaw.wateringDays ? { wateringDays: careRaw.wateringDays } : {}),
      ...(averageSize ? { averageSize } : {}),
      ...(typeof careRaw.maintenanceConditions === "string" && careRaw.maintenanceConditions
        ? { maintenanceConditions: careRaw.maintenanceConditions }
        : {}),
      ...(careInstructions && careInstructions.length > 0 ? { careInstructions } : {}),
    },
  };
}

/** Normalize persisted rows (supports legacy `deliveryStatus` field name). */
function normalizeOrder(entry: unknown): SavedOrder | null {
  if (!entry || typeof entry !== "object") return null;
  const o = entry as Record<string, unknown>;

  const orderId = typeof o.orderId === "string" ? o.orderId : null;
  const id = typeof o.id === "string" && o.id ? o.id : undefined;
  const checkoutSessionId =
    typeof o.checkoutSessionId === "string" && o.checkoutSessionId ? o.checkoutSessionId : undefined;
  const posSpotId = typeof o.posSpotId === "string" && o.posSpotId ? o.posSpotId : undefined;
  const offerId = typeof o.offerId === "string" && o.offerId ? o.offerId : undefined;
  const plantId = typeof o.plantId === "string" ? o.plantId : null;
  const plantName = typeof o.plantName === "string" ? o.plantName : null;

  const locationId: string | null =
    typeof o.locationId === "string" && o.locationId.trim()
      ? o.locationId.trim()
      : null;

  let locationName: string | null =
    typeof o.locationName === "string" ? o.locationName : null;
  if (locationName !== null && locationName.trim() === "") locationName = null;

  let locationAddress: string | null =
    typeof o.locationAddress === "string" ? o.locationAddress : null;
  if (locationAddress !== null && locationAddress.trim() === "") locationAddress = null;

  const price = typeof o.price === "number" && Number.isFinite(o.price) ? o.price : null;
  const fullName = typeof o.fullName === "string" ? o.fullName : null;
  const phone = typeof o.phone === "string" ? o.phone : null;
  const address = typeof o.address === "string" ? o.address : null;
  const apartmentOrNotes =
    typeof o.apartmentOrNotes === "string" ? o.apartmentOrNotes : "";
  const fulfillmentMethod: FulfillmentMethod =
    o.fulfillmentMethod === "pickup" ? "pickup" : "delivery";
  const createdAt = typeof o.createdAt === "string" ? o.createdAt : null;

  let orderStatus: OrderStatus;
  if (o.orderStatus !== undefined) {
    orderStatus = normalizeLegacyOrderStatus(o.orderStatus, "orderStatus");
  } else if (o.deliveryStatus !== undefined) {
    orderStatus = normalizeLegacyOrderStatus(o.deliveryStatus, "deliveryStatus");
  } else {
    orderStatus = "sold";
  }

  const deliveredAt =
    typeof o.deliveredAt === "string" && o.deliveredAt ? o.deliveredAt : undefined;
  const pickedUpAt =
    typeof o.pickedUpAt === "string" && o.pickedUpAt ? o.pickedUpAt : undefined;

  const customerEmail =
    typeof o.customerEmail === "string" && o.customerEmail.trim()
      ? o.customerEmail.trim()
      : undefined;
  const source = o.source === "manual" || o.source === "admin" || o.source === "online" ? o.source : undefined;
  const cancelledAt =
    typeof o.cancelledAt === "string" && o.cancelledAt ? o.cancelledAt : undefined;
  const cancelledBy =
    typeof o.cancelledBy === "string" && o.cancelledBy ? o.cancelledBy : undefined;
  const cancellationReason =
    typeof o.cancellationReason === "string" && o.cancellationReason ? o.cancellationReason : undefined;
  const snapshot = normalizeSnapshot(o.snapshot);

  if (
    !orderId ||
    !plantId ||
    !plantName ||
    price === null ||
    !fullName ||
    (fulfillmentMethod === "delivery" && (!phone || !address)) ||
    !createdAt
  ) {
    return null;
  }

  return {
    ...(id ? { id } : {}),
    orderId,
    ...(checkoutSessionId ? { checkoutSessionId } : {}),
    ...(posSpotId ? { posSpotId } : {}),
    ...(offerId ? { offerId } : {}),
    plantId,
    plantName,
    locationId,
    locationName,
    locationAddress,
    price,
    fullName,
    ...(customerEmail ? { customerEmail } : {}),
    phone: phone ?? "",
    address: address ?? "",
    apartmentOrNotes,
    fulfillmentMethod,
    createdAt,
    orderStatus,
    ...(source ? { source } : {}),
    ...(cancelledAt ? { cancelledAt } : {}),
    ...(cancelledBy ? { cancelledBy } : {}),
    ...(cancellationReason ? { cancellationReason } : {}),
    ...(snapshot ? { snapshot } : {}),
    ...(deliveredAt ? { deliveredAt } : {}),
    ...(pickedUpAt ? { pickedUpAt } : {}),
  };
}

export async function readOrders(): Promise<SavedOrder[]> {
  try {
    const raw = await readFile(ORDERS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeOrder(item))
      .filter((x): x is SavedOrder => x !== null);
  } catch {
    return [];
  }
}

export async function saveOrders(orders: SavedOrder[]): Promise<void> {
  await mkdir(path.dirname(ORDERS_FILE), { recursive: true });
  await writeFile(ORDERS_FILE, `${JSON.stringify(orders, null, 2)}\n`, "utf-8");
}

export async function appendOrder(order: SavedOrder): Promise<void> {
  const orders = await readOrders();
  orders.push(order);
  await saveOrders(orders);
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
  const orders = await readOrders();
  const idx = orders.findIndex((o) => o.orderId === orderId);
  if (idx === -1) return null;

  const updated: SavedOrder = {
    ...orders[idx],
    ...patch,
  };

  orders[idx] = updated;
  await saveOrders(orders);
  return updated;
}

export async function replaceOrder(order: SavedOrder): Promise<SavedOrder | null> {
  const orders = await readOrders();
  const idx = orders.findIndex((o) => o.orderId === order.orderId);
  if (idx === -1) return null;
  orders[idx] = order;
  await saveOrders(orders);
  return order;
}
