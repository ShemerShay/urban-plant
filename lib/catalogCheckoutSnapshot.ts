/**
 * Catalog checkout line snapshot and supplier-cost capture.
 * Cost is copied when a catalog attempt is created.
 * Later product edits do not rewrite a stored snapshot.
 * Supplier cost 0 is a real cost. Null means the source price was null.
 */

import "server-only";

import { sql } from "@/lib/db";
import { parseNumeric } from "@/lib/storageUtils";

export const PLANT_UNIT_COST_SOURCE = "plants.supplier_price@sale" as const;
export const POT_UNIT_COST_SOURCE = "pots.supplier_price@sale" as const;
export const LEGACY_POT_UNIT_COST_SOURCE = "pot_sizes.supplier_price@sale" as const;

export type PlantUnitCostSource = typeof PLANT_UNIT_COST_SOURCE;
export type PotUnitCostSource =
  | typeof POT_UNIT_COST_SOURCE
  | typeof LEGACY_POT_UNIT_COST_SOURCE;

export type CatalogCurrency = "ILS" | "USD" | "EUR";

export type SupplierCostSnapshot<Source extends string> = {
  cost: number | null;
  source: Source | null;
};

/** One historical catalog line. Sale price is the Offer price. Cost is supplier cost only. */
export type CatalogPaymentSnapshotLine = {
  lineNo: number;
  plantId: string;
  plantVariantId: string;
  sellableVariantId: string;
  offerId: string;
  potId: string | null;
  potSizeId: string | null;
  potColorId: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  currency: CatalogCurrency;
  plantName: string;
  plantNameHe: string | null;
  sizeLabel: string | null;
  potName: string | null;
  potSizeLabel: string | null;
  potColor: string | null;
  potColorHe: string | null;
  plantUnitCost: number | null;
  plantUnitCostSource: PlantUnitCostSource | null;
  potUnitCost: number | null;
  potUnitCostSource: PotUnitCostSource | null;
};

export type CatalogPaymentSnapshot = {
  sourcePartnerId: string | null;
  lines: CatalogPaymentSnapshotLine[];
};

function moneyCents(value: number): number {
  return Math.round(value * 100);
}

export function catalogLineTotal(unitPrice: number, quantity: number): number {
  return unitPrice * quantity;
}

/**
 * A supplier price of 0 is stored. Missing and negative prices become null.
 * Supplier cost is never a selling price.
 */
export function supplierCostFromPrice<Source extends string>(
  supplierPrice: unknown,
  source: Source,
): SupplierCostSnapshot<Source> {
  if (
    supplierPrice == null ||
    supplierPrice === "" ||
    (typeof supplierPrice !== "number" && typeof supplierPrice !== "string")
  ) {
    return { cost: null, source: null };
  }
  const supplierCost = parseNumeric(supplierPrice);
  if (!Number.isFinite(supplierCost) || supplierCost < 0) {
    return { cost: null, source: null };
  }
  return { cost: supplierCost, source };
}

export function plantUnitCostFromSupplierPrice(supplierPrice: unknown): {
  plantUnitCost: number | null;
  plantUnitCostSource: PlantUnitCostSource | null;
} {
  const snapshot = supplierCostFromPrice(supplierPrice, PLANT_UNIT_COST_SOURCE);
  return { plantUnitCost: snapshot.cost, plantUnitCostSource: snapshot.source };
}

export function potUnitCostFromSupplierPrice(supplierPrice: unknown): {
  potUnitCost: number | null;
  potUnitCostSource: PotUnitCostSource | null;
} {
  const snapshot = supplierCostFromPrice(supplierPrice, POT_UNIT_COST_SOURCE);
  return { potUnitCost: snapshot.cost, potUnitCostSource: snapshot.source };
}

function parseRequiredText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseOptionalText(value: unknown): string | null | undefined {
  if (value == null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parsePositiveMoney(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function parseNonNegativeMoney(value: unknown): number | null | undefined {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

function parseCurrency(value: unknown): CatalogCurrency | null {
  if (value === "ILS" || value === "USD" || value === "EUR") return value;
  return null;
}

function parseSnapshotLine(value: unknown): CatalogPaymentSnapshotLine | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const lineNo = parsePositiveInt(row.lineNo);
  const plantId = parseRequiredText(row.plantId);
  const plantVariantId = parseRequiredText(row.plantVariantId);
  const sellableVariantId = parseRequiredText(row.sellableVariantId);
  const offerId = parseRequiredText(row.offerId);
  const potId = parseOptionalText(row.potId);
  const potSizeId = parseOptionalText(row.potSizeId);
  const potColorId = parseOptionalText(row.potColorId);
  const quantity = parsePositiveInt(row.quantity);
  const unitPrice = parsePositiveMoney(row.unitPrice);
  const lineTotal = parsePositiveMoney(row.lineTotal);
  const currency = parseCurrency(row.currency);
  const plantName = parseRequiredText(row.plantName);
  const plantNameHe = parseOptionalText(row.plantNameHe);
  const sizeLabel = parseOptionalText(row.sizeLabel);
  const potName = parseOptionalText(row.potName);
  const potSizeLabel = parseOptionalText(row.potSizeLabel);
  const potColor = parseOptionalText(row.potColor);
  const potColorHe = parseOptionalText(row.potColorHe);
  const plantUnitCost = parseNonNegativeMoney(row.plantUnitCost);
  const potUnitCost = parseNonNegativeMoney(row.potUnitCost);
  const plantSource = row.plantUnitCostSource;
  const potSource = row.potUnitCostSource;
  if (
    lineNo == null ||
    !plantId ||
    !plantVariantId ||
    !sellableVariantId ||
    !offerId ||
    potId === undefined ||
    potSizeId === undefined ||
    potColorId === undefined ||
    quantity == null ||
    unitPrice == null ||
    lineTotal == null ||
    !currency ||
    !plantName ||
    plantNameHe === undefined ||
    sizeLabel === undefined ||
    potName === undefined ||
    potSizeLabel === undefined ||
    potColor === undefined ||
    potColorHe === undefined ||
    plantUnitCost === undefined ||
    potUnitCost === undefined
  ) {
    return null;
  }
  const hasPlantCost = plantUnitCost != null;
  const hasPlantSource = plantSource != null;
  if (hasPlantCost !== hasPlantSource) return null;
  if (hasPlantSource && plantSource !== PLANT_UNIT_COST_SOURCE) return null;
  const hasPotCost = potUnitCost != null;
  const hasPotSource = potSource != null;
  if (hasPotCost !== hasPotSource) return null;
  if (
    hasPotSource &&
    potSource !== POT_UNIT_COST_SOURCE &&
    potSource !== LEGACY_POT_UNIT_COST_SOURCE
  ) {
    return null;
  }
  if ((potSizeId == null) !== (potColorId == null)) return null;
  if (potId == null && potSizeId == null && (potName != null || potUnitCost != null)) return null;
  if (moneyCents(catalogLineTotal(unitPrice, quantity)) !== moneyCents(lineTotal)) return null;
  return {
    lineNo,
    plantId,
    plantVariantId,
    sellableVariantId,
    offerId,
    potId,
    potSizeId,
    potColorId,
    quantity,
    unitPrice,
    lineTotal,
    currency,
    plantName,
    plantNameHe,
    sizeLabel,
    potName,
    potSizeLabel,
    potColor,
    potColorHe,
    plantUnitCost,
    plantUnitCostSource: hasPlantCost ? PLANT_UNIT_COST_SOURCE : null,
    potUnitCost,
    potUnitCostSource: hasPotCost ? (potSource as PotUnitCostSource) : null,
  };
}

/** Keep stored costs. Does not read plants. */
export function parseCatalogPaymentSnapshot(value: unknown): CatalogPaymentSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const sourcePartnerId = parseOptionalText(row.sourcePartnerId);
  if (sourcePartnerId === undefined) return undefined;
  if (!Array.isArray(row.lines) || row.lines.length === 0) return undefined;
  const lines: CatalogPaymentSnapshotLine[] = [];
  const lineNos = new Set<number>();
  for (const raw of row.lines) {
    const line = parseSnapshotLine(raw);
    if (!line || lineNos.has(line.lineNo)) return undefined;
    lineNos.add(line.lineNo);
    lines.push(line);
  }
  lines.sort((a, b) => a.lineNo - b.lineNo);
  return { sourcePartnerId, lines };
}

export async function snapshotPlantUnitCosts(
  plantIds: string[],
): Promise<Map<string, { plantUnitCost: number | null; plantUnitCostSource: PlantUnitCostSource | null }>> {
  const ids = [...new Set(plantIds.map((id) => id.trim()).filter(Boolean))];
  const costs = new Map<
    string,
    { plantUnitCost: number | null; plantUnitCostSource: PlantUnitCostSource | null }
  >();
  for (const id of ids) costs.set(id, plantUnitCostFromSupplierPrice(null));
  if (ids.length === 0) return costs;
  const rows = await sql`
    SELECT id, supplier_price
    FROM plants
    WHERE id = ANY(${ids}::text[])
  `;
  for (const row of rows as { id: string; supplier_price: string | number | null }[]) {
    costs.set(String(row.id), plantUnitCostFromSupplierPrice(row.supplier_price));
  }
  return costs;
}

export async function snapshotPotUnitCosts(
  potIds: Array<string | null>,
): Promise<Map<string, { potUnitCost: number | null; potUnitCostSource: PotUnitCostSource | null }>> {
  const ids = [...new Set(potIds.filter((id): id is string => Boolean(id?.trim())))];
  const costs = new Map<
    string,
    { potUnitCost: number | null; potUnitCostSource: PotUnitCostSource | null }
  >();
  if (ids.length === 0) return costs;
  const rows = await sql`
    SELECT id::text AS id, supplier_price
    FROM pots
    WHERE id = ANY(${ids}::uuid[])
  `;
  for (const row of rows as { id: string; supplier_price: string | number | null }[]) {
    costs.set(String(row.id), potUnitCostFromSupplierPrice(row.supplier_price));
  }
  return costs;
}

/** Replace line costs from current supplier prices. Drops any non-snapshot fields. */
export async function snapshotCatalogPaymentPlantCosts(
  snapshot: CatalogPaymentSnapshot,
): Promise<CatalogPaymentSnapshot> {
  const plantCosts = await snapshotPlantUnitCosts(snapshot.lines.map((line) => line.plantId));
  const potCosts = await snapshotPotUnitCosts(snapshot.lines.map((line) => line.potId));
  return {
    sourcePartnerId: snapshot.sourcePartnerId,
    lines: snapshot.lines.map((line) => {
      const plant = plantCosts.get(line.plantId) ?? plantUnitCostFromSupplierPrice(null);
      const pot = line.potId
        ? (potCosts.get(line.potId) ?? potUnitCostFromSupplierPrice(null))
        : potUnitCostFromSupplierPrice(null);
      return {
        ...line,
        plantUnitCost: plant.plantUnitCost,
        plantUnitCostSource: plant.plantUnitCostSource,
        potUnitCost: line.potId ? pot.potUnitCost : null,
        potUnitCostSource: line.potId ? pot.potUnitCostSource : null,
      };
    }),
  };
}
