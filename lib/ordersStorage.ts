/**
 * Local JSON order management is only for prototype/testing and should be replaced
 * with a real database before production.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import type { FulfillmentMethod, SavedOrder } from "./orderTypes";
import type { OrderStatus } from "./status";
import { isOrderStatus } from "./status";

const ORDERS_FILE = path.join(process.cwd(), "data", "orders.json");

function normalizeLegacyOrderStatus(raw: unknown, source: "orderStatus" | "deliveryStatus"): OrderStatus {
  if (isOrderStatus(raw)) return raw;
  /**
   * Legacy `deliveryStatus` only: "available"/"pending" meant order placed, awaiting fulfillment.
   * Do not treat `orderStatus: "available"` as legacy — that is the real released-to-shelf state.
   */
  if (source === "deliveryStatus" && (raw === "available" || raw === "pending")) {
    return "sold";
  }
  return "sold";
}

/** Normalize persisted rows (supports legacy `deliveryStatus` field name). */
function normalizeOrder(entry: unknown): SavedOrder | null {
  if (!entry || typeof entry !== "object") return null;
  const o = entry as Record<string, unknown>;

  const orderId = typeof o.orderId === "string" ? o.orderId : null;
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
    orderId,
    plantId,
    plantName,
    locationId,
    locationName,
    locationAddress,
    price,
    fullName,
    phone: phone ?? "",
    address: address ?? "",
    apartmentOrNotes,
    fulfillmentMethod,
    createdAt,
    orderStatus,
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

export async function deleteOrderById(orderId: string): Promise<boolean> {
  const orders = await readOrders();
  const next = orders.filter((o) => o.orderId !== orderId);
  if (next.length === orders.length) return false;
  await saveOrders(next);
  return true;
}

export async function patchOrderById(
  orderId: string,
  patch: Partial<Pick<SavedOrder, "orderStatus" | "deliveredAt" | "pickedUpAt">>,
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
