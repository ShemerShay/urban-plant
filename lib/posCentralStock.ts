/**
 * Place / Replace from Back Office stock onto a POS, in one Neon transaction.
 * Update, Remove, sale, holds, and flowers do not use this module for inventory writes.
 */

import { sql } from "@/lib/db";
import {
  occupancyActionNeedsInventorySource,
  parseInventorySource,
  type InventorySource,
} from "@/lib/inventorySource";
import {
  InventoryChangeError,
  mapInventoryWriteError,
  prepareInventoryDelta,
} from "@/lib/inventoryStorage";
import type { OccupancyIntent } from "@/lib/posOccupancy";
import {
  appendPosSpot,
  finalizePreparedPosSpotUpdate,
  getPosSpotById,
  insertPosSpotWithOccupancyGuardQuery,
  PosSpotSlugConflictError,
  preparePosSpotUpdate,
  updatePosSpot,
  type PosSpotUpdatePatch,
} from "@/lib/posSpotStorage";
import type { PosSpot } from "@/lib/posSpotTypes";

export class PosCentralStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PosCentralStockError";
  }
}

export class OccupancyWriteFailedError extends Error {
  constructor() {
    super("Could not update POS Spot");
    this.name = "OccupancyWriteFailedError";
  }
}

export function requireInventorySource(value: unknown): InventorySource {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
    throw new PosCentralStockError("inventorySource is required for Place and Replace");
  }
  const parsed = parseInventorySource(value);
  if (!parsed) {
    throw new PosCentralStockError("inventorySource is invalid");
  }
  return parsed;
}

function rethrowCombinedWriteError(error: unknown): never {
  if (error instanceof PosCentralStockError) throw error;
  if (error instanceof OccupancyWriteFailedError) throw error;
  if (error instanceof InventoryChangeError) throw error;
  if (error instanceof PosSpotSlugConflictError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  if (/division by zero/i.test(message)) {
    throw new OccupancyWriteFailedError();
  }
  if (/duplicate key|already exists/i.test(message)) {
    throw new PosSpotSlugConflictError();
  }
  mapInventoryWriteError(error);
}

export function posCentralStockHttpError(
  error: unknown,
): { status: number; error: string } | null {
  if (error instanceof PosCentralStockError) {
    return { status: 400, error: error.message };
  }
  if (error instanceof OccupancyWriteFailedError) {
    return { status: 400, error: error.message };
  }
  if (error instanceof InventoryChangeError) {
    if (error.code === "insufficient_quantity") {
      return { status: 400, error: "This variant has no remaining Back Office stock" };
    }
    return { status: 400, error: error.message };
  }
  if (error instanceof PosSpotSlugConflictError) {
    return { status: 409, error: "Spot slug is already used by another POS Spot" };
  }
  return null;
}

export async function commitPosCreateFromCentral(input: {
  posSpot: PosSpot;
  variantId: string;
}): Promise<PosSpot> {
  const variantId = input.variantId.trim();
  const preparedInv = await prepareInventoryDelta({
    variantId,
    delta: -1,
    note: `POS place ${input.posSpot.id}`,
  });
  try {
    await sql.transaction([
      ...preparedInv.queries,
      insertPosSpotWithOccupancyGuardQuery(input.posSpot, variantId),
    ]);
  } catch (error) {
    rethrowCombinedWriteError(error);
  }
  const created = await getPosSpotById(input.posSpot.id);
  if (!created) throw new OccupancyWriteFailedError();
  return created;
}

export async function commitPosUpdateFromCentral(input: {
  id: string;
  patch: PosSpotUpdatePatch;
  variantId: string;
  action: "place" | "replace";
  existing: PosSpot;
}): Promise<PosSpot | null> {
  const variantId = input.variantId.trim();
  const occupancyWriteGuard =
    input.action === "place"
      ? ({ kind: "place" } as const)
      : {
          kind: "replace" as const,
          plantVariantId: input.existing.plantVariantId ?? null,
          offerPlacedAt: input.existing.offerPlacedAt ?? null,
        };

  const preparedUpdate = await preparePosSpotUpdate(input.id, {
    ...input.patch,
    occupancyAction: input.action,
    occupancyWriteGuard,
  });
  if (!preparedUpdate) return null;

  const preparedInv = await prepareInventoryDelta({
    variantId,
    delta: -1,
    note: `POS ${input.action} ${input.id}`,
  });

  try {
    await sql.transaction([
      ...preparedInv.queries,
      preparedUpdate.query,
    ]);
  } catch (error) {
    rethrowCombinedWriteError(error);
  }

  await finalizePreparedPosSpotUpdate(preparedUpdate);
  return (await getPosSpotById(input.id)) ?? null;
}

export async function writePosCreate(input: {
  occupancyAction: OccupancyIntent;
  inventorySource: unknown;
  posSpot: PosSpot;
  variantId: string | null | undefined;
}): Promise<PosSpot> {
  if (!occupancyActionNeedsInventorySource(input.occupancyAction)) {
    await appendPosSpot(input.posSpot);
    return input.posSpot;
  }
  const source = requireInventorySource(input.inventorySource);
  if (source === "already_at_partner") {
    await appendPosSpot(input.posSpot, { openCycle: true });
    return input.posSpot;
  }
  const variantId = input.variantId?.trim() || "";
  if (!variantId) {
    throw new PosCentralStockError("Place requires a known plant variant");
  }
  return commitPosCreateFromCentral({ posSpot: input.posSpot, variantId });
}

export async function writePosUpdate(input: {
  occupancyAction: OccupancyIntent;
  inventorySource: unknown;
  id: string;
  patch: PosSpotUpdatePatch;
  existing: PosSpot;
  variantId: string | null | undefined;
}): Promise<PosSpot | null> {
  if (!occupancyActionNeedsInventorySource(input.occupancyAction)) {
    return updatePosSpot(input.id, {
      ...input.patch,
      occupancyAction: input.occupancyAction,
    });
  }
  const source = requireInventorySource(input.inventorySource);
  if (source === "already_at_partner") {
    return updatePosSpot(input.id, {
      ...input.patch,
      occupancyAction: input.occupancyAction,
    });
  }
  const variantId = input.variantId?.trim() || "";
  if (!variantId) {
    throw new PosCentralStockError(
      `${input.occupancyAction === "replace" ? "Replace" : "Place"} requires a known plant variant`,
    );
  }
  return commitPosUpdateFromCentral({
    id: input.id,
    patch: input.patch,
    variantId,
    action: input.occupancyAction === "replace" ? "replace" : "place",
    existing: input.existing,
  });
}
