/**
 * Derived supplier cost for one Sellable Variant.
 * Not stored. A missing component is not zero.
 */

export type DerivedSupplierCost = {
  supplierCost: number | null;
  plantSupplierCost: number | null;
  potSupplierCost: number | null;
  /** True when a Catalog Pot is part of the Variant and that pot has no supplier cost. */
  missingPotSupplierCost: boolean;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function finiteCost(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return roundMoney(value);
}

export function deriveSellableVariantSupplierCost(input: {
  plantSupplierCost: number | null;
  potId: string | null;
  potSupplierCost: number | null;
}): DerivedSupplierCost {
  const plantSupplierCost = finiteCost(input.plantSupplierCost);
  if (input.potId == null) {
    return {
      supplierCost: plantSupplierCost,
      plantSupplierCost,
      potSupplierCost: null,
      missingPotSupplierCost: false,
    };
  }
  const potSupplierCost = finiteCost(input.potSupplierCost);
  if (plantSupplierCost == null || potSupplierCost == null) {
    return {
      supplierCost: null,
      plantSupplierCost,
      potSupplierCost,
      missingPotSupplierCost: potSupplierCost == null,
    };
  }
  return {
    supplierCost: roundMoney(plantSupplierCost + potSupplierCost),
    plantSupplierCost,
    potSupplierCost,
    missingPotSupplierCost: false,
  };
}
