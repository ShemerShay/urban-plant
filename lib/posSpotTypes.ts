export type PosSpotStatus = "available" | "sold" | "inactive";

export type MaintenanceStatus = "checked" | "needs_watering" | "needs_treatment";

export interface PosSpot {
  id: string;
  partnerLocationId: string;
  posNumber?: string;
  spotDescription: string;
  placementNotes?: string;
  spotSlug: string;
  currentOfferId: string;
  status: PosSpotStatus;
  placedAt?: string;
  latestMaintenanceStatus?: MaintenanceStatus;
  lastCheckedAt?: string;
  lastWateredAt?: string;
  lastHandledAt?: string;
  lastHandledBy?: string;
  createdAt: string;
}
