import type { FulfillmentMethod, SavedOrder } from "./orderTypes";

export type CreatePendingOrderInput = {
  orderId: string;
  plantId: string;
  plantName: string;
  /** Same as catalog unit price (ILS etc.). */
  amount: number;
  customerName: string;
  customerEmail: string;
  fulfillmentMethod: FulfillmentMethod;
  phone: string;
  address: string;
  apartmentOrNotes: string;
  locationId: string | null;
  locationName: string | null;
  locationAddress: string | null;
};

/** Build a persisted row awaiting CardCom confirmation (no shelf / inventory change yet). */
export function createPendingOrder(input: CreatePendingOrderInput): SavedOrder {
  const createdAt = new Date().toISOString();

  return {
    orderId: input.orderId,
    plantId: input.plantId,
    plantName: input.plantName,
    locationId: input.locationId,
    locationName: input.locationName,
    locationAddress: input.locationAddress,
    price: input.amount,
    fullName: input.customerName,
    customerEmail: input.customerEmail,
    phone: input.phone,
    address: input.address,
    apartmentOrNotes: input.apartmentOrNotes,
    fulfillmentMethod: input.fulfillmentMethod,
    createdAt,
    orderStatus: "pending_payment",
    paymentStatus: "pending_payment",
  };
}
