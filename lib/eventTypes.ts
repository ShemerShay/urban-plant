export type ActivityEventType =
  | "order_created"
  | "order_cancelled"
  | "manual_status_update"
  | "plant_placed";

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  posSpotId?: string;
  offerId?: string;
  orderId?: string;
  productId?: string;
  partnerLocationId?: string;
  createdAt: string;
  createdBy?: string;
  data?: Record<string, unknown>;
}
