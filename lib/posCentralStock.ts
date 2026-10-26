/**
 * Place / Replace / new-color Update from Back Office stock onto a POS, in one Neon transaction.
 * Same-color Update, Remove, sale, holds, and flowers do not use this module for inventory writes.
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
import {
  PotInventoryChangeError,
  preparePotInventoryDelta,
} from "@/lib/potInventoryStorage";
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

export function requireInventorySource(value: unknown, reason = "Place and Replace"): InventorySource {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
    throw new PosCentralStockError(`inventorySource is required for ${reason}`);
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
  if (error instanceof PotInventoryChangeError) throw error;
  if (error instanceof PosSpotSlugConflictError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  if (/division by zero/i.test(message)) {
    if (/pot_inventory/i.test(message)) {
      throw new PotInventoryChangeError(
        "insufficient_quantity",
        "This pot color has no remaining Back Office stock",
      );
    }
    throw new OccupancyWriteFailedError();
  }
  if (/duplicate key|already exists/i.test(message)) {
    throw new PosSpotSlugConflictError();
  }
  if (/pot_inventory_quantity_non_negative/i.test(message)) {
    throw new PotInventoryChangeError(
      "insufficient_quantity",
      "This pot color has no remaining Back Office stock",
    );
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
  if (error instanceof PotInventoryChangeError) {
    if (error.code === "insufficient_quantity") {
      return { status: 400, error: "This pot color has no remaining Back Office stock" };
    }
    return { status: 400, error: error.message };
  }
  if (error instanceof PosSpotSlugConflictError) {
    return { status: 409, error: "Spot slug is already used by another POS Spot" };
  }
  return null;
}

async function plantLockAndDelta(input: {
  variantId: string;
  note: string;
}): Promise<ReturnType<typeof sql>[]> {
  const preparedInv = await prepareInventoryDelta({
    variantId: input.variantId,
    delta: -1,
    note: input.note,
  });
  return [
    sql`
      SELECT quantity
      FROM inventory
      WHERE variant_id = ${input.variantId.trim()}::uuid
      FOR UPDATE
    `,
    ...preparedInv.queries,
  ];
}

async function colorLockAndDelta(input: {
  potColorId: string;
  note: string;
}): Promise<ReturnType<typeof sql>[]> {
  const prepared = await preparePotInventoryDelta({
    potColorId: input.potColorId,
    delta: -1,
    note: input.note,
  });
  return prepared.queries;
}

export async function commitPosCreateFromCentral(input: {
  posSpot: PosSpot;
  variantId: string;
  potColorId?: string | null;
}): Promise<PosSpot> {
  const variantId = input.variantId.trim();
  const potColorId = input.potColorId?.trim() || "";
  const queries = [
    ...(await plantLockAndDelta({
      variantId,
      note: `POS place ${input.posSpot.id}`,
    })),
    ...(potColorId
      ? await colorLockAndDelta({
          potColorId,
          note: `POS place ${input.posSpot.id}`,
        })
      : []),
    insertPosSpotWithOccupancyGuardQuery(input.posSpot, variantId),
  ];
  try {
    await sql.transaction(queries);
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
  potColorId?: string | null;
  action: "place" | "replace" | "update";
  existing: PosSpot;
  decrementPlant: boolean;
  decrementPotColor: boolean;
}): Promise<PosSpot | null> {
  const variantId = input.variantId.trim();
  const occupancyWriteGuard =
    input.action === "place"
      ? ({ kind: "place" } as const)
      : input.action === "replace"
        ? {
            kind: "replace" as const,
            plantVariantId: input.existing.plantVariantId ?? null,
            offerPlacedAt: input.existing.offerPlacedAt ?? null,
          }
        : undefined;

  const preparedUpdate = await preparePosSpotUpdate(input.id, {
    ...input.patch,
    occupancyAction: input.action,
    occupancyWriteGuard,
  });
  if (!preparedUpdate) return null;

  const queries: ReturnType<typeof sql>[] = [];
  if (input.decrementPlant) {
    queries.push(
      ...(await plantLockAndDelta({
        variantId,
        note: `POS ${input.action} ${input.id}`,
      })),
    );
  }
  const potColorId = input.potColorId?.trim() || "";
  if (input.decrementPotColor && potColorId) {
    queries.push(
      ...(await colorLockAndDelta({
        potColorId,
        note: `POS ${input.action} ${input.id}`,
      })),
    );
  }
  queries.push(preparedUpdate.query);

  try {
    await sql.transaction(queries);
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
  potColorId?: string | null;
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
  return commitPosCreateFromCentral({
    posSpot: input.posSpot,
    variantId,
    potColorId: input.potColorId,
  });
}

export async function writePosUpdate(input: {
  occupancyAction: OccupancyIntent;
  inventorySource: unknown;
  introducesNewPotColor?: boolean;
  id: string;
  patch: PosSpotUpdatePatch;
  existing: PosSpot;
  variantId: string | null | undefined;
  potColorId?: string | null;
}): Promise<PosSpot | null> {
  const needsSource = occupancyActionNeedsInventorySource(
    input.occupancyAction,
    Boolean(input.introducesNewPotColor),
  );
  if (!needsSource) {
    return updatePosSpot(input.id, {
      ...input.patch,
      occupancyAction: input.occupancyAction,
    });
  }
  const source = requireInventorySource(
    input.inventorySource,
    input.occupancyAction === "update" ? "a new Pot Color" : "Place and Replace",
  );
  if (source === "already_at_partner") {
    return updatePosSpot(input.id, {
      ...input.patch,
      occupancyAction: input.occupancyAction,
    });
  }

  const action =
    input.occupancyAction === "replace"
      ? "replace"
      : input.occupancyAction === "place"
        ? "place"
        : "update";
  const decrementPlant = action === "place" || action === "replace";
  const decrementPotColor =
    action === "place" || action === "replace"
      ? Boolean(input.potColorId?.trim())
      : Boolean(input.introducesNewPotColor && input.potColorId?.trim());

  if (decrementPlant) {
    const variantId = input.variantId?.trim() || "";
    if (!variantId) {
      throw new PosCentralStockError(
        `${action === "replace" ? "Replace" : "Place"} requires a known plant variant`,
      );
    }
  }
  if (decrementPotColor && !input.potColorId?.trim()) {
    throw new PosCentralStockError("A pot-bearing Offer requires a Pot Color");
  }

  return commitPosUpdateFromCentral({
    id: input.id,
    patch: input.patch,
    variantId: input.variantId?.trim() || "",
    potColorId: input.potColorId,
    action,
    existing: input.existing,
    decrementPlant,
    decrementPotColor,
  });
}
