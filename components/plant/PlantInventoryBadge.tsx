import { getInventoryDisplayStatus } from "@/lib/inventoryStorage";
import { INVENTORY_STATUS_LABELS } from "@/lib/status";

interface PlantShelfBadgeProps {
  plantId: string;
  locationId: string | undefined;
}

/** Availability at a partner location (shelf state for this plant unit). */
export async function PlantInventoryBadge({ plantId, locationId }: PlantShelfBadgeProps) {
  const status = await getInventoryDisplayStatus(plantId, locationId);
  if (status === null) return null;

  const label = INVENTORY_STATUS_LABELS[status];
  const isAvailable = status === "available";

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
