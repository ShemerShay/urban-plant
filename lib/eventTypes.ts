export type ActivityEventType =
  | "order_created"
  | "order_cancelled"
  | "manual_status_update"
  | "plant_placed"
  | "plant_sold"
  | "plant_removed"
  | "plant_replaced"
  | "qr_scanned"
  | "plant_status_changed"
  | "location_visit";

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
