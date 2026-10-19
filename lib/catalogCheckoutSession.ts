"use client";

import {
  CATALOG_CART_STORAGE_KEY,
  parseCatalogCart,
  parseCatalogCartItem,
  subtractPurchasedCatalogItems,
  type CatalogCartItem,
} from "@/lib/catalogCart";
import { writeCatalogCart } from "@/lib/catalogCartStore";
import { shouldClearCatalogCartOnStatus } from "@/lib/catalogCheckoutFlow";

export const CATALOG_CHECKOUT_SNAPSHOT_KEY = "up_catalog_checkout_snapshot";

export type CatalogCheckoutSnapshot = {
  attemptId: string;
  items: CatalogCartItem[];
};

export function rememberCatalogCheckoutSnapshot(snapshot: CatalogCheckoutSnapshot): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(CATALOG_CHECKOUT_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // Private mode can reject storage. Success clearing then keeps the Cart.
  }
}

export function readCatalogCheckoutSnapshot(): CatalogCheckoutSnapshot | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CATALOG_CHECKOUT_SNAPSHOT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object") return null;
    const record = data as Record<string, unknown>;
    const attemptId = typeof record.attemptId === "string" ? record.attemptId.trim() : "";
    if (!attemptId || !Array.isArray(record.items)) return null;
    const items: CatalogCartItem[] = [];
    for (const row of record.items) {
      const item = parseCatalogCartItem(row);
      if (!item) return null;
      items.push(item);
    }
    if (items.length === 0) return null;
    return { attemptId, items };
  } catch {
    return null;
  }
}

export function forgetCatalogCheckoutSnapshot(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(CATALOG_CHECKOUT_SNAPSHOT_KEY);
  } catch {
    // Ignore storage failures.
  }
}

/**
 * Subtract the purchased lines after the status API confirms finalization.
 * Pending, failed, and confirmation-required states leave the Cart in place.
 */
export function clearCatalogCartForPaymentStatus(input: {
  state: string;
  urlAttemptId: string | null;
}): boolean {
  const snapshot = readCatalogCheckoutSnapshot();
  if (
    !shouldClearCatalogCartOnStatus({
      state: input.state,
      urlAttemptId: input.urlAttemptId,
      snapshotAttemptId: snapshot?.attemptId ?? null,
    }) ||
    !snapshot
  ) {
    return false;
  }

  let raw: string | null = null;
  try {
    raw = localStorage.getItem(CATALOG_CART_STORAGE_KEY);
  } catch {
    raw = null;
  }
  writeCatalogCart(subtractPurchasedCatalogItems(parseCatalogCart(raw), snapshot.items));
  forgetCatalogCheckoutSnapshot();
  return true;
}
