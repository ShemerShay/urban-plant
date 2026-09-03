/**
 * Post-payment Cardcom document + Urban Plant email (non-blocking for payment/POS).
 * Failures never undo verified payment or sold POS.
 */

import "server-only";

import {
  isCardcomEnvironment,
  type CardcomEnvironment,
} from "@/lib/cardcom";
import {
  createCardcomDocument,
  fetchCardcomDocumentPdf,
  type CardcomDocumentInfo,
} from "@/lib/cardcomDocuments";
import { formatPrice } from "@/lib/mockPlants";
import type { SavedOrder } from "@/lib/orderTypes";
import { CARDCOM_FLOWER_LINE_ITEM_NAME, inventoryTypeOrDefault } from "@/lib/inventoryType";
import {
  claimPurchaseEmailProcessing,
  ensurePurchaseEmailPending,
  getOrderById,
  markPurchaseEmailFailed,
  markPurchaseEmailSent,
  saveCardcomDocumentOnOrder,
} from "@/lib/ordersStorage";
import { getPlantById } from "@/lib/plantCatalog";
import { sendPurchaseEmail } from "@/lib/purchaseEmail";
import { isVerifiedPaidOrderStatus } from "@/lib/status";

export type ProcessOrderDocumentAndEmailDeps = {
  createDocument?: typeof createCardcomDocument;
  fetchPdf?: typeof fetchCardcomDocumentPdf;
  sendEmail?: typeof sendPurchaseEmail;
};

export type ProcessOrderDocumentAndEmailResult = {
  outcome:
    | "sent"
    | "already_sent"
    | "busy"
    | "skipped"
    | "failed";
  error?: string;
};

function resolveEnvironment(order: SavedOrder): CardcomEnvironment {
  return isCardcomEnvironment(order.cardcomEnv) ? order.cardcomEnv : "production";
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 500);
  }
  return "Document or email processing failed";
}

function buildDeliveryAddress(order: SavedOrder): string | undefined {
  if (order.fulfillmentMethod !== "delivery") return undefined;
  const line = [order.address?.trim(), order.apartmentOrNotes?.trim()]
    .filter(Boolean)
    .join(", ");
  return line || undefined;
}

async function resolveDocument(
  order: SavedOrder,
  deps: ProcessOrderDocumentAndEmailDeps,
): Promise<CardcomDocumentInfo> {
  if (
    order.cardcomDocumentType &&
    typeof order.cardcomDocumentNumber === "number" &&
    Number.isFinite(order.cardcomDocumentNumber)
  ) {
    return {
      documentType: order.cardcomDocumentType,
      documentNumber: order.cardcomDocumentNumber,
    };
  }

  const dealNumber = order.cardcomTransactionId;
  if (typeof dealNumber !== "number" || !Number.isFinite(dealNumber)) {
    throw new Error("Missing cardcom_transaction_id for CreateDocument");
  }

  const email = order.customerEmail?.trim();
  if (!email) {
    throw new Error("Missing customer email for CreateDocument");
  }

  const catalogPlant = order.plantId ? await getPlantById(order.plantId) : undefined;
  const isFlower = inventoryTypeOrDefault(catalogPlant?.inventoryType) === "flowers";
  const publicProductName = isFlower
    ? CARDCOM_FLOWER_LINE_ITEM_NAME
    : order.plantName || "Customer";

  const createDocument = deps.createDocument ?? createCardcomDocument;
  const created = await createDocument(
    {
      dealNumber,
      name: order.fullName || "Customer",
      email,
      phone: order.phone || "",
      addressLine1: buildDeliveryAddress(order),
      productDescription: publicProductName,
      unitCost: order.price,
      externalId: order.orderId,
    },
    { environment: resolveEnvironment(order) },
  );

  const saved = await saveCardcomDocumentOnOrder({
    orderId: order.orderId,
    documentType: created.documentType,
    documentNumber: created.documentNumber,
  });
  if (!saved) {
    throw new Error("Failed to persist Cardcom document info");
  }

  return created;
}

/**
 * After payment/POS finalization: claim processing, create/reuse document, attach PDF, send email.
 * Safe to call on duplicate webhooks (atomic claim + sent_at guard).
 */
export async function processOrderDocumentAndEmail(
  orderId: string,
  deps: ProcessOrderDocumentAndEmailDeps = {},
): Promise<ProcessOrderDocumentAndEmailResult> {
  const trimmedId = orderId.trim();
  if (!trimmedId) {
    return { outcome: "skipped", error: "missing_order_id" };
  }

  const before = await getOrderById(trimmedId);
  if (!before) {
    return { outcome: "skipped", error: "order_not_found" };
  }
  if (!isVerifiedPaidOrderStatus(before.orderStatus)) {
    return { outcome: "skipped", error: "order_not_paid" };
  }
  if (before.purchaseEmailSentAt || before.purchaseEmailStatus === "sent") {
    return { outcome: "already_sent" };
  }

  const catalogPlant = before.plantId
    ? await getPlantById(before.plantId)
    : undefined;
  if (
    inventoryTypeOrDefault(catalogPlant?.inventoryType) === "flowers" &&
    !before.customerEmail?.trim()
  ) {
    return { outcome: "skipped", error: "flower_no_customer_email" };
  }

  await ensurePurchaseEmailPending(trimmedId);

  const claimed = await claimPurchaseEmailProcessing(trimmedId);
  if (!claimed.ok) {
    if (claimed.reason === "already_sent") {
      return { outcome: "already_sent" };
    }
    if (claimed.reason === "busy") {
      return { outcome: "busy" };
    }
    return { outcome: "skipped", error: claimed.reason };
  }

  const order = claimed.order;

  try {
    const document = await resolveDocument(order, deps);
    const fetchPdf = deps.fetchPdf ?? fetchCardcomDocumentPdf;
    const pdf = await fetchPdf(document, {
      environment: resolveEnvironment(order),
    });

    const customerEmail = order.customerEmail?.trim();
    if (!customerEmail) {
      throw new Error("Missing customer email for purchase confirmation");
    }

    let careInstructions: string[] = [];
    let publicPlantName = order.plantName || "your plant";
    try {
      const plant = order.plantId
        ? await getPlantById(order.plantId)
        : undefined;
      if (inventoryTypeOrDefault(plant?.inventoryType) === "flowers") {
        publicPlantName = CARDCOM_FLOWER_LINE_ITEM_NAME;
      } else {
        careInstructions = (plant?.careInstructions ?? [])
          .map((line) => line.trim())
          .filter(Boolean);
      }
    } catch (error) {
      console.error("[cardcom-document-email] care instructions lookup failed", {
        orderId: order.orderId,
        plantId: order.plantId,
        error: safeErrorMessage(error),
      });
    }

    const sendEmail = deps.sendEmail ?? sendPurchaseEmail;
    await sendEmail({
      customerEmail,
      fullName: order.fullName,
      plantName: publicPlantName,
      priceDisplay: formatPrice(order.price, "ILS"),
      fulfillmentMethod: order.fulfillmentMethod,
      ...(careInstructions.length > 0 ? { careInstructions } : {}),
      attachments: [
        {
          filename: pdf.filename,
          content: pdf.bytes,
          contentType: "application/pdf",
        },
      ],
    });

    const marked = await markPurchaseEmailSent(order.orderId);
    if (!marked) {
      // Email may have been sent; treat missing mark as failure for retry safety only if sent_at unset.
      const again = await getOrderById(order.orderId);
      if (again?.purchaseEmailSentAt) {
        return { outcome: "already_sent" };
      }
      throw new Error("Failed to mark purchase email as sent");
    }

    return { outcome: "sent" };
  } catch (error) {
    const message = safeErrorMessage(error);
    await markPurchaseEmailFailed(order.orderId, message);
    console.error("[cardcom-document-email] failed", {
      orderId: order.orderId,
      error: message,
    });
    return { outcome: "failed", error: message };
  }
}
