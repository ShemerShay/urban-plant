/**
 * Cardcom purchase lines for a finalized Catalog order.
 * Prices and names come from order_items snapshots, never live catalog or supplier data.
 */

export type CatalogDocumentLineSource = {
  plantName: string;
  potName: string | null;
  quantity: number;
  plantUnitPrice: number;
  potUnitPrice: number | null;
  lineTotal: number;
};

export type CatalogDocumentProduct = {
  description: string;
  quantity: number;
  unitCost: number;
};

function moneyCents(value: number): number {
  return Math.round(value * 100);
}

/** Product name, with the stored pot name when that pot was part of the purchased line. */
export function catalogLineDescription(line: {
  plantName: string;
  potName: string | null;
}): string {
  const plant = line.plantName.trim() || "Plant";
  const pot = line.potName?.trim();
  return pot ? `${plant} (${pot})` : plant;
}

/**
 * One Cardcom product per purchased line.
 * Unit cost is the plant price plus the optional pot price. Quantity stays the purchased quantity.
 */
export function buildCatalogDocumentProducts(
  lines: CatalogDocumentLineSource[],
  orderTotal: number,
): CatalogDocumentProduct[] {
  if (lines.length === 0) {
    throw new Error("Catalog order has no order items for CreateDocument");
  }

  const products = lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error("Catalog document line quantity is invalid");
    }
    if (!Number.isFinite(line.plantUnitPrice) || line.plantUnitPrice <= 0) {
      throw new Error("Catalog document line plant price is invalid");
    }
    const potUnitPrice = line.potUnitPrice ?? 0;
    if (!Number.isFinite(potUnitPrice) || potUnitPrice < 0) {
      throw new Error("Catalog document line pot price is invalid");
    }
    const unitCost = line.plantUnitPrice + potUnitPrice;
    if (moneyCents(unitCost * line.quantity) !== moneyCents(line.lineTotal)) {
      throw new Error("Catalog document line total does not match purchased prices");
    }
    return {
      description: catalogLineDescription(line),
      quantity: line.quantity,
      unitCost,
    };
  });

  const documentTotal = products.reduce(
    (sum, product) => sum + product.unitCost * product.quantity,
    0,
  );
  if (moneyCents(documentTotal) !== moneyCents(orderTotal)) {
    throw new Error("Catalog document total does not match the finalized order total");
  }

  return products;
}

/** Stored product names for the existing single-plant confirmation email. */
export function catalogCustomerProductLabel(
  lines: Array<{ plantName: string; potName: string | null; quantity: number }>,
): string {
  const label = lines
    .map((line) => {
      const name = catalogLineDescription(line);
      return line.quantity > 1 ? `${name} x ${line.quantity}` : name;
    })
    .filter(Boolean)
    .join(", ");
  return label || "your plant";
}
