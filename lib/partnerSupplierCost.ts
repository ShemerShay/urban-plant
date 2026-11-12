/**
 * Partner and Flower supplier cost frozen from the plant row already loaded
 * at payment prep. 0 is a real cost. Missing and negative prices are omitted.
 */

export const PARTNER_SUPPLIER_UNIT_COST_SOURCE = "plants.supplier_price@sale" as const;

export type PartnerSupplierUnitCost = {
  supplierUnitCost: number;
  supplierUnitCostSource: typeof PARTNER_SUPPLIER_UNIT_COST_SOURCE;
};

function finiteCost(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
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
  if (source.supplierUnitCostSource !== PARTNER_SUPPLIER_UNIT_COST_SOURCE) return {};
  const cost = finiteCost(source.supplierUnitCost);
  if (cost == null || cost < 0) return {};
  return {
    supplierUnitCost: cost,
    supplierUnitCostSource: PARTNER_SUPPLIER_UNIT_COST_SOURCE,
  };
}
