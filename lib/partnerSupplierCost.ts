/**
 * Partner and Flower supplier cost frozen from the Plant Size at payment prep.
 * 0 is a real cost. Missing and negative prices are omitted.
 * Legacy POS rows without a Plant Size store a null cost rather than inventing one.
 * Historical snapshots may still use plants.supplier_price@sale.
 */

export const PARTNER_SUPPLIER_UNIT_COST_SOURCE = "plant_variants.supplier_price@sale" as const;
export const LEGACY_PARTNER_SUPPLIER_UNIT_COST_SOURCE = "plants.supplier_price@sale" as const;

export type PartnerSupplierUnitCostSource =
  | typeof PARTNER_SUPPLIER_UNIT_COST_SOURCE
  | typeof LEGACY_PARTNER_SUPPLIER_UNIT_COST_SOURCE;

export type PartnerSupplierUnitCost = {
  supplierUnitCost: number;
  supplierUnitCostSource: PartnerSupplierUnitCostSource;
};

function finiteCost(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function isPartnerSupplierUnitCostSource(
  value: unknown,
): value is PartnerSupplierUnitCostSource {
  return (
    value === PARTNER_SUPPLIER_UNIT_COST_SOURCE ||
    value === LEGACY_PARTNER_SUPPLIER_UNIT_COST_SOURCE
  );
}

export function partnerSupplierCostFromPlantPrice(
  supplierPrice: unknown,
): PartnerSupplierUnitCost | null {
  const cost = finiteCost(supplierPrice);
  if (cost == null || cost < 0) return null;
  return {
    supplierUnitCost: cost,
    supplierUnitCostSource: PARTNER_SUPPLIER_UNIT_COST_SOURCE,
  };
}

export function parseStoredPartnerSupplierCost(
  source: Record<string, unknown>,
): Partial<PartnerSupplierUnitCost> {
  if (!isPartnerSupplierUnitCostSource(source.supplierUnitCostSource)) return {};
  const cost = finiteCost(source.supplierUnitCost);
  if (cost == null || cost < 0) return {};
  return {
    supplierUnitCost: cost,
    supplierUnitCostSource: source.supplierUnitCostSource,
  };
}
