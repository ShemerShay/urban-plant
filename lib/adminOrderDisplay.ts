/**
 * Client-safe Admin views for Catalog order lines and reconciliation attempts.
 * Names and prices come from stored snapshots. Does not read live Catalog data.
 */

import { catalogLineDescription } from "@/lib/catalogDocumentLines";
import type { Locale } from "@/lib/locale";
import type { OrderCardcomEnv } from "@/lib/orderTypes";

type CatalogCurrency = "ILS" | "USD" | "EUR";

export type AdminCatalogLineView = {
  lineNo: number;
  plantId: string;
  plantName: string;
  plantNameHe: string | null;
  sizeLabel: string | null;
  potName: string | null;
  potColor: string | null;
  quantity: number;
  plantUnitPrice: number;
  potUnitPrice: number | null;
  lineTotal: number;
  currency: CatalogCurrency;
};

export type AdminReconciliationAttemptView = {
  id: string;
  createdAt: string;
  fullName: string;
  phone: string;
  customerEmail: string;
  address: string;
  apartmentOrNotes: string;
  amount: number;
  currency: CatalogCurrency;
  failureReason: string | null;
  cardcomTransactionId?: number;
  cardcomEnv?: OrderCardcomEnv;
  checkoutSessionId?: string;
  lines: AdminCatalogLineView[];
};

type StoredCatalogLine = {
  lineNo: number;
  plantId: string;
  plantName: string;
  plantNameHe: string | null;
  sizeLabel: string | null;
  potName: string | null;
  potColor: string | null;
  quantity: number;
  plantUnitPrice: number;
  potUnitPrice: number | null;
  lineTotal: number;
  currency: string;
};

function catalogCurrency(value: string): CatalogCurrency {
  return value === "USD" || value === "EUR" ? value : "ILS";
}

export function catalogLineViewFromStoredLine(line: StoredCatalogLine): AdminCatalogLineView {
  return {
    lineNo: line.lineNo,
    plantId: line.plantId,
    plantName: line.plantName,
    plantNameHe: line.plantNameHe,
    sizeLabel: line.sizeLabel,
    potName: line.potName,
    potColor: line.potColor,
    quantity: line.quantity,
    plantUnitPrice: line.plantUnitPrice,
    potUnitPrice: line.potUnitPrice,
    lineTotal: line.lineTotal,
    currency: catalogCurrency(line.currency),
  };
}

export function catalogStoredPlantName(
  line: Pick<AdminCatalogLineView, "plantName" | "plantNameHe">,
  locale: Locale,
): string {
  const hebrew = line.plantNameHe?.trim();
  if (locale === "he" && hebrew) return hebrew;
  return line.plantName.trim() || "Plant";
}

export function catalogStoredPotLabel(
  line: Pick<AdminCatalogLineView, "potName" | "potColor">,
): string | null {
  const name = line.potName?.trim();
  const color = line.potColor?.trim();
  if (name && color) return `${name} · ${color}`;
  return name || color || null;
}

export function catalogStoredItemSummary(
  lines: AdminCatalogLineView[],
  locale: Locale,
): string {
  const label = lines
    .map((line) => {
      const name = catalogLineDescription({
        plantName: catalogStoredPlantName(line, locale),
        potName: catalogStoredPotLabel(line),
      });
      return line.quantity > 1 ? `${name} x ${line.quantity}` : name;
    })
    .filter(Boolean)
    .join(", ");
  return label;
}

export function catalogItemsRecordFromOrderItems(
  itemsByOrderId: { get(orderId: string): readonly StoredCatalogLine[] | undefined },
  catalogOrderIds: Iterable<string>,
): Record<string, AdminCatalogLineView[]> {
  const record: Record<string, AdminCatalogLineView[]> = {};
  for (const orderId of catalogOrderIds) {
    const items = itemsByOrderId.get(orderId) ?? [];
    record[orderId] = items.map(catalogLineViewFromStoredLine);
  }
  return record;
}

export function catalogLinesFromSnapshot(snapshot: {
  lines?: StoredCatalogLine[] | null;
} | null | undefined): AdminCatalogLineView[] {
  if (!snapshot?.lines?.length) return [];
  return snapshot.lines.map(catalogLineViewFromStoredLine);
}

export function reconciliationAttemptViewFromAttempt(attempt: {
  id: string;
  createdAt: string;
  fullName: string;
  phone: string;
  customerEmail: string;
  address: string;
  apartmentOrNotes: string;
  amount: number;
  failureReason?: string;
  cardcomTransactionId?: number;
  cardcomEnv?: OrderCardcomEnv;
  checkoutSessionId?: string;
  catalogSnapshot?: { lines: StoredCatalogLine[] };
}): AdminReconciliationAttemptView {
  const lines = catalogLinesFromSnapshot(attempt.catalogSnapshot);
  return {
    id: attempt.id,
    createdAt: attempt.createdAt,
    fullName: attempt.fullName,
    phone: attempt.phone,
    customerEmail: attempt.customerEmail,
    address: attempt.address,
    apartmentOrNotes: attempt.apartmentOrNotes,
    amount: attempt.amount,
    currency: lines[0]?.currency ?? "ILS",
    failureReason: attempt.failureReason?.trim() || null,
    ...(attempt.cardcomTransactionId != null
      ? { cardcomTransactionId: attempt.cardcomTransactionId }
      : {}),
    ...(attempt.cardcomEnv ? { cardcomEnv: attempt.cardcomEnv } : {}),
    ...(attempt.checkoutSessionId ? { checkoutSessionId: attempt.checkoutSessionId } : {}),
    lines,
  };
}

export function isCatalogAdminOrder(order: { channel?: string }): boolean {
  return order.channel === "catalog";
}
