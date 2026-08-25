import type { InventoryType } from "@/lib/inventoryType";
import type { FulfillmentMethod } from "@/lib/orderTypes";

/** Flower checkout never offers Delivery as a selectable method. */
export function isCheckoutDeliveryDisabled(inventoryType: InventoryType): boolean {
  return inventoryType === "flowers";
}

/**
 * Partner `pickupDisabled` hides Pickup for plants only.
 * Flowers always keep Pickup visible (and selected).
 */
export function hideCheckoutPickupOption(
  inventoryType: InventoryType,
  pickupDisabled: boolean,
): boolean {
  return pickupDisabled && inventoryType !== "flowers";
}

export function defaultCheckoutFulfillment(input: {
  inventoryType: InventoryType;
  pickupDisabled: boolean;
  resumeFulfillment?: FulfillmentMethod;
}): FulfillmentMethod {
  if (isCheckoutDeliveryDisabled(input.inventoryType)) return "pickup";
  if (hideCheckoutPickupOption(input.inventoryType, input.pickupDisabled)) {
    return "delivery";
  }
  if (input.resumeFulfillment === "pickup") return "pickup";
  return "delivery";
}
