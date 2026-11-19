/**
 * Fire-and-forget Urban Plant alert when a Catalog attempt first needs reconciliation.
 * Email failure is logged and never thrown to the payment path.
 */

import "server-only";

import { formatCatalogPrice } from "@/lib/catalogPriceFormat";
import type { SavedPaymentAttempt } from "@/lib/paymentAttemptTypes";
import {
  sendInternalCatalogReconciliationAlert,
  type PurchaseEmailOrderLine,
} from "@/lib/purchaseEmail";

function alertErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 500);
  }
  return "Catalog reconciliation alert failed";
}

export async function notifyCatalogNeedsReconciliation(
  attempt: SavedPaymentAttempt,
): Promise<void> {
  if (attempt.channel !== "catalog") return;
  try {
    const lines: PurchaseEmailOrderLine[] = (attempt.catalogSnapshot?.lines ?? []).map(
      (line) => ({
        plantName: line.plantName,
        potName: line.potName,
        quantity: line.quantity,
      }),
    );
    const currency = attempt.catalogSnapshot?.lines[0]?.currency ?? "ILS";
    await sendInternalCatalogReconciliationAlert({
      attemptId: attempt.id,
      fullName: attempt.fullName,
      customerEmail: attempt.customerEmail,
      amountDisplay: formatCatalogPrice(attempt.amount, currency, "en"),
      ...(attempt.phone.trim() ? { phone: attempt.phone } : {}),
      ...(attempt.address.trim() ? { address: attempt.address } : {}),
      ...(attempt.apartmentOrNotes.trim()
        ? { apartmentOrNotes: attempt.apartmentOrNotes }
        : {}),
      ...(attempt.failureReason ? { failureReason: attempt.failureReason } : {}),
      ...(attempt.cardcomTransactionId != null
        ? { cardcomTransactionId: attempt.cardcomTransactionId }
        : {}),
      ...(attempt.checkoutSessionId
        ? { checkoutSessionId: attempt.checkoutSessionId }
        : {}),
      lines,
    });
  } catch (error) {
    console.error("[catalog-reconciliation-alert] send_failed", {
      attemptId: attempt.id,
      error: alertErrorMessage(error),
    });
  }
}