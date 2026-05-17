import type { FulfillmentMethod } from "./orderTypes";

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

export type CheckoutSessionDraft = CreatePendingOrderInput & {
  id: string;
  status: "pending_payment";
  createdAt: string;
  paymentProviderSessionId?: string;
};

/** Build a future checkout-session draft. Pending payment state does not live on Order. */
export function createPendingOrder(input: CreatePendingOrderInput): CheckoutSessionDraft {
  const createdAt = new Date().toISOString();

  return {
    ...input,
    id: input.orderId,
    createdAt,
    status: "pending_payment",
  };
}
