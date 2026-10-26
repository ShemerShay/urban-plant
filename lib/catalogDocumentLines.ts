/**
 * Cardcom purchase lines for a finalized Catalog order.
 * Prices and names come from order_items snapshots, never live catalog or supplier data.
 */

export type CatalogDocumentLineSource = {
  plantName: string;
  potName: string | null;
  quantity: number;
  unitPrice: number;
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
 * Unit cost is the Offer unit price. Quantity stays the purchased quantity.
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
    if (!Number.isFinite(line.unitPrice) || line.unitPrice <= 0) {
      throw new Error("Catalog document line price is invalid");
    }
    if (moneyCents(line.unitPrice * line.quantity) !== moneyCents(line.lineTotal)) {
      throw new Error("Catalog document line total does not match the Offer price");
    }
    return {
      description: catalogLineDescription(line),
      quantity: line.quantity,
      unitCost: line.unitPrice,
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
