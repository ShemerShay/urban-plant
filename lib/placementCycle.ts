/**
 * Placement Cycle write effect for a POS occupancy mutation.
 * Cycle rows are written in the same SQL statement as the occupancy change.
 */

import type { OccupancyIntent } from "@/lib/posOccupancy";
import type { PosSpotStatus } from "@/lib/posSpotTypes";

export const CYCLE_END_REASONS = ["sold", "removed", "replaced", "deactivated"] as const;

export type CycleEndReason = (typeof CYCLE_END_REASONS)[number];

export const PLACEMENT_KINDS = ["initial", "restock"] as const;

export type PlacementKind = (typeof PLACEMENT_KINDS)[number];

export type CycleWriteEffect =
  | { kind: "none" }
  | { kind: "open" }
  | { kind: "close"; reason: "removed" | "deactivated" | "sold" }
  | { kind: "replace" }
  | { kind: "pause_segment" }
  | { kind: "resume_segment" };

function trimmedId(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Map a POS occupancy write onto Cycle open / close / replace.
 * Flowers never open a Cycle (no occupying variant).
 *
 * Deactivate / reactivate with the same physical plant is not a Cycle boundary:
 * it is neither `initial` nor `restock`. The open Cycle continues.
 * Deactivate closes the current Segment (inactive time is not exposure).
 * Reactivate opens a new Segment on that same Cycle.
 * `end_reason = 'deactivated'` remains valid on historical rows only.
 */
export function cycleEffectForPosWrite(input: {
  occupancyAction?: OccupancyIntent | null;
  existingStatus: PosSpotStatus;
  nextStatus: PosSpotStatus;
  existingVariantId: string | null | undefined;
  nextVariantId: string | null | undefined;
}): CycleWriteEffect {
  const action = input.occupancyAction ?? "update";
  const existingVariant = trimmedId(input.existingVariantId);
  const nextVariant = trimmedId(input.nextVariantId);

  if (action === "replace" || (existingVariant && nextVariant && existingVariant !== nextVariant)) {
    return { kind: "replace" };
  }

  if (action === "place" || (!existingVariant && nextVariant)) {
    return { kind: "open" };
  }

  if (action === "remove" || (existingVariant && !nextVariant)) {
    return existingVariant ? { kind: "close", reason: "removed" } : { kind: "none" };
  }

  if (existingVariant && nextVariant) {
    if (
      action === "deactivate" ||
      (input.nextStatus === "inactive" && input.existingStatus !== "inactive")
    ) {
      return { kind: "pause_segment" };
    }
    if (input.existingStatus === "inactive" && input.nextStatus !== "inactive") {
      return { kind: "resume_segment" };
    }
  }

  return { kind: "none" };
}

export function cycleSqlFlags(effect: CycleWriteEffect): {
  shouldClose: boolean;
  shouldOpen: boolean;
  pauseSegment: boolean;
  resumeSegment: boolean;
  closeReason: CycleEndReason;
  placementKind: PlacementKind;
} {
  if (effect.kind === "replace") {
    return {
      shouldClose: true,
      shouldOpen: true,
      pauseSegment: false,
      resumeSegment: false,
      closeReason: "replaced",
      placementKind: "restock",
    };
  }
  if (effect.kind === "open") {
    return {
      shouldClose: false,
      shouldOpen: true,
      pauseSegment: false,
      resumeSegment: false,
      closeReason: "removed",
      placementKind: "initial",
    };
  }
  if (effect.kind === "close") {
    return {
      shouldClose: true,
      shouldOpen: false,
      pauseSegment: false,
      resumeSegment: false,
      closeReason: effect.reason,
      placementKind: "initial",
    };
  }
  if (effect.kind === "pause_segment") {
    return {
      shouldClose: false,
      shouldOpen: false,
      pauseSegment: true,
      resumeSegment: false,
      closeReason: "removed",
      placementKind: "initial",
    };
  }
  if (effect.kind === "resume_segment") {
    return {
      shouldClose: false,
      shouldOpen: false,
      pauseSegment: false,
      resumeSegment: true,
      closeReason: "removed",
      placementKind: "initial",
    };
  }
  return {
    shouldClose: false,
    shouldOpen: false,
    pauseSegment: false,
    resumeSegment: false,
    closeReason: "removed",
    placementKind: "initial",
  };
}
