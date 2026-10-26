/**
 * Client-safe Catalog checkout decisions.
 * Prices and stock stay on the server. This module only compares and routes UI state.
 */

import type { CatalogCartItem, CatalogCartResolvedLine } from "@/lib/catalogCart";

export type CatalogCheckoutPaymentLine = {
  plantId: string;
  plantSizeId: string;
  sellableVariantId: string;
  offerId: string;
  potColorId: string | null;
  quantity: number;
  unitPrice: number;
};

export type CatalogCheckoutResumeLine = {
  key: string;
  name: string;
  nameHe: string | null;
  sizeLabel: string | null;
  quantity: number;
  unitPrice: number;
  potName: string | null;
  potSizeLabel: string | null;
  potColor: string | null;
  lineTotal: number;
  currency: "ILS" | "USD" | "EUR";
};

export type CatalogCheckoutResume = {
  orderId: string;
  resumeToken: string;
  showPaymentFailed: boolean;
  fullName: string;
  phone: string;
  email: string;
  address: string;
  apartmentOrNotes: string;
  amount: number;
  currency: "ILS" | "USD" | "EUR";
  lines: CatalogCheckoutResumeLine[];
};

export type CatalogCheckoutNotice = "cart_changed" | "insufficient_stock";

export type CatalogCheckoutPaymentFailure = {
  notice: CatalogCheckoutNotice | null;
  refreshCart: boolean;
  reviewRequired: boolean;
};

function moneyEqual(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

export function catalogCheckoutPaymentLines(
  lines: CatalogCartResolvedLine[],
): CatalogCheckoutPaymentLine[] | null {
  const paymentLines: CatalogCheckoutPaymentLine[] = [];
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) return null;
    if (!(line.unitPrice > 0)) return null;
    paymentLines.push({
      plantId: line.plantId,
      plantSizeId: line.plantSizeId,
      sellableVariantId: line.sellableVariantId,
      offerId: line.offerId,
      potColorId: line.potColorId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    });
  }
  return paymentLines.length > 0 ? paymentLines : null;
}

/** True when two server snapshots describe the same purchasable cart. */
export function catalogCheckoutLinesMatch(
  displayed: CatalogCartResolvedLine[],
  next: CatalogCartResolvedLine[],
): boolean {
  if (displayed.length !== next.length) return false;
  return displayed.every((line, index) => {
    const other = next[index];
    if (!other) return false;
    return (
      line.plantId === other.plantId &&
      line.plantSizeId === other.plantSizeId &&
      line.sellableVariantId === other.sellableVariantId &&
      line.offerId === other.offerId &&
      line.potColorId === other.potColorId &&
      line.quantity === other.quantity &&
      moneyEqual(line.unitPrice, other.unitPrice)
    );
  });
}

export function catalogCheckoutPaymentFailure(
  code: string | undefined,
): CatalogCheckoutPaymentFailure {
  if (code === "cart_changed") {
    return { notice: "cart_changed", refreshCart: true, reviewRequired: true };
  }
  if (code === "insufficient_stock") {
    return { notice: "insufficient_stock", refreshCart: true, reviewRequired: false };
  }
  return { notice: null, refreshCart: false, reviewRequired: false };
}

export function claimCatalogCheckoutSubmit(guard: { busy: boolean }): boolean {
  if (guard.busy) return false;
  guard.busy = true;
  return true;
}

export function releaseCatalogCheckoutSubmit(guard: { busy: boolean }): void {
  guard.busy = false;
}

/** Cart clearing is allowed only after this attempt is confirmed finalized. */
export function shouldClearCatalogCartOnStatus(input: {
  state: string;
  urlAttemptId: string | null;
  snapshotAttemptId: string | null;
}): boolean {
  return (
    input.state === "completed" &&
    input.urlAttemptId != null &&
    input.urlAttemptId.length > 0 &&
    input.snapshotAttemptId != null &&
    input.urlAttemptId === input.snapshotAttemptId
  );
}

export function catalogCheckoutSnapshotItems(
  lines: Array<
    Pick<
      CatalogCartItem,
      "plantId" | "plantSizeId" | "sellableVariantId" | "offerId" | "potColorId" | "quantity"
    >
  >,
): CatalogCartItem[] {
  return lines.map((line) => ({
    plantId: line.plantId,
    plantSizeId: line.plantSizeId,
    sellableVariantId: line.sellableVariantId,
    offerId: line.offerId,
    potColorId: line.potColorId,
    quantity: line.quantity,
  }));
}
