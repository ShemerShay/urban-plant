/**
 * Whether the customer can start checkout for this catalog plant at a partner location.
 * Without a location (no QR anchor), purchase is allowed.
 * With a location: shelf must be `available` and there must be no existing order
 * for this plant+location in sold / picked_up / delivered (not when `available`).
 */

import { getInventoryDisplayStatus } from "@/lib/inventoryStorage";
import { readOrders } from "@/lib/ordersStorage";
import type { OrderStatus } from "@/lib/status";

function blocksPurchase(status: OrderStatus): boolean {
  return status === "sold" || status === "picked_up" || status === "delivered";
}

export async function canPurchasePlantAtLocation(
  plantId: string,
  locationId: string | null | undefined,
): Promise<boolean> {
  if (!locationId?.trim()) return true;

  const loc = locationId.trim();
  const shelf = await getInventoryDisplayStatus(plantId, locationId);
  if (shelf !== "available") return false;

  const orders = await readOrders();
  const blocked = orders.some(
    (o) =>
      o.plantId === plantId &&
      o.locationId === loc &&
      blocksPurchase(o.orderStatus),
  );
  return !blocked;
}
