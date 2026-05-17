import { findLegacyPosSpot, getPosSpotBySpotSlug } from "@/lib/posSpotStorage";
import { INVENTORY_STATUS_LABELS } from "@/lib/status";

interface PlantShelfBadgeProps {
  plantId?: string;
  locationId?: string | undefined;
  spotSlug?: string;
}

/** Availability at the POS Spot that owns the QR. */
export async function PlantInventoryBadge({ plantId, locationId, spotSlug }: PlantShelfBadgeProps) {
  const posSpot = spotSlug
    ? await getPosSpotBySpotSlug(spotSlug)
    : plantId
      ? (await findLegacyPosSpot(plantId, locationId))?.posSpot
      : undefined;
  if (!posSpot) return null;

  const label = INVENTORY_STATUS_LABELS[posSpot.status];
  const isAvailable = posSpot.status === "available";

  return (
    <div
      className={`w-fit rounded-xl px-3 py-2 text-xs font-semibold tracking-wide ${
        isAvailable
          ? "bg-emerald-50 text-emerald-800"
          : "bg-neutral-200/90 text-neutral-900"
      }`}
    >
      {label}
    </div>
  );
}
