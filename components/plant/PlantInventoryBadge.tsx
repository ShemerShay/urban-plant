import { INVENTORY_STATUS_LABELS } from "@/lib/status";
import type { PosSpotStatus } from "@/lib/posSpotTypes";

interface PlantInventoryBadgeProps {
  /** Canonical POS status for this page render (post hold-expiry cleanup). */
  status: PosSpotStatus;
}

/** Availability at the POS Spot that owns the QR. */
export function PlantInventoryBadge({ status }: PlantInventoryBadgeProps) {
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
