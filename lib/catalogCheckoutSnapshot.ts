/**
 * Catalog checkout line snapshot and supplier-cost capture.
 * Cost is copied from plants.supplier_price when a catalog attempt is created.
 * Later plant edits do not rewrite a stored snapshot.
 */

import "server-only";

import { sql } from "@/lib/db";
import { parseNumeric } from "@/lib/storageUtils";

export const PLANT_UNIT_COST_SOURCE = "plants.supplier_price@sale" as const;

export type PlantUnitCostSource = typeof PLANT_UNIT_COST_SOURCE;

export type CatalogCurrency = "ILS" | "USD" | "EUR";

export type PlantUnitCostSnapshot = {
  plantUnitCost: number | null;
  plantUnitCostSource: PlantUnitCostSource | null;
};

/** One historical catalog line. Sale prices are customer prices. Cost is supplier cost only. */
export type CatalogPaymentSnapshotLine = {
  lineNo: number;
  plantId: string;
  plantVariantId: string;
  potVariantId: string | null;
  quantity: number;
  plantUnitPrice: number;
  potUnitPrice: number | null;
  lineTotal: number;
  currency: CatalogCurrency;
  plantName: string;
  plantNameHe: string | null;
  sizeLabel: string | null;
  potName: string | null;
  potColor: string | null;
  plantUnitCost: number | null;
  plantUnitCostSource: PlantUnitCostSource | null;
};

export type CatalogPaymentSnapshot = {
  sourcePartnerId: string | null;
  lines: CatalogPaymentSnapshotLine[];
};

function moneyCents(value: number): number {
  return Math.round(value * 100);
}

export function catalogLineTotal(
  plantUnitPrice: number,
  potUnitPrice: number | null,
  quantity: number,
): number {
  return (plantUnitPrice + (potUnitPrice ?? 0)) * quantity;
}

/**
 * plants.supplier_price is Urban Plant's supplier cost.
 * A positive price is snapshotted. Missing, zero, and negative become null.
 * There is no pot cost.
 */
export function plantUnitCostFromSupplierPrice(supplierPrice: unknown): PlantUnitCostSnapshot {
  if (
    supplierPrice == null ||
    supplierPrice === "" ||
    (typeof supplierPrice !== "number" && typeof supplierPrice !== "string")
  ) {
    return { plantUnitCost: null, plantUnitCostSource: null };
  }
  const price = parseNumeric(supplierPrice);
  if (price <= 0) {
    return { plantUnitCost: null, plantUnitCostSource: null };
  }
  return {
    plantUnitCost: price,
    plantUnitCostSource: PLANT_UNIT_COST_SOURCE,
  };
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

function parseOptionalPositiveMoney(value: unknown): number | null | undefined {
  if (value == null) return null;
  return parsePositiveMoney(value);
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

function parseCurrency(value: unknown): CatalogCurrency | null {
  if (value === "ILS" || value === "USD" || value === "EUR") return value;
  return null;
}

function parseCostSnapshot(value: Record<string, unknown>): PlantUnitCostSnapshot | null {
  const cost = value.plantUnitCost;
  const source = value.plantUnitCostSource;
  if (cost == null && source == null) {
    return { plantUnitCost: null, plantUnitCostSource: null };
  }
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost <= 0) return null;
  if (source !== PLANT_UNIT_COST_SOURCE) return null;
  return { plantUnitCost: cost, plantUnitCostSource: PLANT_UNIT_COST_SOURCE };
}

function parseSnapshotLine(value: unknown): CatalogPaymentSnapshotLine | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const lineNo = parsePositiveInt(row.lineNo);
  const plantId = parseRequiredText(row.plantId);
  const plantVariantId = parseRequiredText(row.plantVariantId);
  const potVariantId = parseOptionalText(row.potVariantId);
  const quantity = parsePositiveInt(row.quantity);
  const plantUnitPrice = parsePositiveMoney(row.plantUnitPrice);
  const potUnitPrice = parseOptionalPositiveMoney(row.potUnitPrice);
  const lineTotal = parsePositiveMoney(row.lineTotal);
  const currency = parseCurrency(row.currency);
  const plantName = parseRequiredText(row.plantName);
  const plantNameHe = parseOptionalText(row.plantNameHe);
  const sizeLabel = parseOptionalText(row.sizeLabel);
  const potName = parseOptionalText(row.potName);
  const potColor = parseOptionalText(row.potColor);
  const cost = parseCostSnapshot(row);
  if (
    lineNo == null ||
    !plantId ||
    !plantVariantId ||
    potVariantId === undefined ||
    quantity == null ||
    plantUnitPrice == null ||
    potUnitPrice === undefined ||
    lineTotal == null ||
    !currency ||
    !plantName ||
    plantNameHe === undefined ||
    sizeLabel === undefined ||
    potName === undefined ||
    potColor === undefined ||
    !cost
  ) {
    return null;
  }
  if ((potVariantId == null) !== (potUnitPrice == null)) return null;
  const expected = catalogLineTotal(plantUnitPrice, potUnitPrice, quantity);
  if (moneyCents(expected) !== moneyCents(lineTotal)) return null;
  return {
    lineNo,
    plantId,
    plantVariantId,
    potVariantId,
    quantity,
    plantUnitPrice,
    potUnitPrice,
    lineTotal,
    currency,
    plantName,
    plantNameHe,
    sizeLabel,
    potName,
    potColor,
    plantUnitCost: cost.plantUnitCost,
    plantUnitCostSource: cost.plantUnitCostSource,
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
): Promise<Map<string, PlantUnitCostSnapshot>> {
  const ids = [...new Set(plantIds.map((id) => id.trim()).filter(Boolean))];
  const costs = new Map<string, PlantUnitCostSnapshot>();
  for (const id of ids) {
    costs.set(id, { plantUnitCost: null, plantUnitCostSource: null });
  }
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

/** Replace line costs from current plants.supplier_price. Drops any non-snapshot fields. */
export async function snapshotCatalogPaymentPlantCosts(
  snapshot: CatalogPaymentSnapshot,
): Promise<CatalogPaymentSnapshot> {
  const costs = await snapshotPlantUnitCosts(snapshot.lines.map((line) => line.plantId));
  return {
    sourcePartnerId: snapshot.sourcePartnerId,
    lines: snapshot.lines.map((line) => {
      const cost = costs.get(line.plantId) ?? {
        plantUnitCost: null,
        plantUnitCostSource: null,
      };
      return {
        lineNo: line.lineNo,
        plantId: line.plantId,
        plantVariantId: line.plantVariantId,
        potVariantId: line.potVariantId,
        quantity: line.quantity,
        plantUnitPrice: line.plantUnitPrice,
        potUnitPrice: line.potUnitPrice,
        lineTotal: line.lineTotal,
        currency: line.currency,
        plantName: line.plantName,
        plantNameHe: line.plantNameHe,
        sizeLabel: line.sizeLabel,
        potName: line.potName,
        potColor: line.potColor,
        plantUnitCost: cost.plantUnitCost,
        plantUnitCostSource: cost.plantUnitCostSource,
      };
    }),
  };
}
