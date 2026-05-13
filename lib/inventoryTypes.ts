import type { InventoryStatus } from "./status";

/** One physical plant unit offered at a partner location (pilot JSON storage). */
export interface InventoryRecord {
  plantId: string;
  locationId: string;
  status: InventoryStatus;
}
