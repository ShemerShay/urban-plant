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
  buildCatalogDocumentProducts,
  catalogCustomerProductLabel,
} from "@/lib/catalogDocumentLines";
import {
  createCardcomDocument,
  fetchCardcomDocumentPdf,
  type CardcomDocumentInfo,
} from "@/lib/cardcomDocuments";
import { formatPrice } from "@/lib/mockPlants";
import { getOrderItemsByOrderId, type OrderItem } from "@/lib/orderItemStorage";
import type { SavedOrder } from "@/lib/orderTypes";
import { CARDCOM_FLOWER_LINE_ITEM_NAME, inventoryTypeOrDefault } from "@/lib/inventoryType";
import {
  claimPurchaseEmailProcessing,
  ensurePurchaseEmailPending,
  getOrderById,
  markPurchaseEmailFailed,
  markPurchaseEmailSent,
  markPurchaseEmailSkipped,
  saveCardcomDocumentOnOrder,
} from "@/lib/ordersStorage";
import { getPlantById } from "@/lib/plantCatalog";
import {
  sendInternalOrderNotificationEmail,
  sendPurchaseEmail,
  URBAN_PLANT_NOTIFICATION_TO,
  type PurchaseEmailCareSection,
  type PurchaseEmailOrderLine,
} from "@/lib/purchaseEmail";
import { isVerifiedPaidOrderStatus } from "@/lib/status";

export type ProcessOrderDocumentAndEmailDeps = {
  createDocument?: typeof createCardcomDocument;
  fetchPdf?: typeof fetchCardcomDocumentPdf;
  sendEmail?: typeof sendPurchaseEmail;
  sendInternalNotification?: typeof sendInternalOrderNotificationEmail;
  /** Catalog customer emails load current care text. Defaults to the plant catalog. */
  loadPlant?: typeof getPlantById;
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

/**
 * Current care text for each distinct plant on a Catalog order.
 * A lookup failure or an empty list leaves that plant without care and does not fail the email.
 */
async function loadCatalogCustomerCare(
  items: OrderItem[],
  loadPlant: (id: string) => Promise<{ careInstructions?: string[] } | undefined>,
): Promise<PurchaseEmailCareSection[]> {
  const seen = new Set<string>();
  const sections: PurchaseEmailCareSection[] = [];
  for (const item of items) {
    const plantId = item.plantId.trim();
    if (!plantId || seen.has(plantId)) continue;
    seen.add(plantId);
    let careInstructions: string[] = [];
    try {
      const plant = await loadPlant(plantId);
      careInstructions = (plant?.careInstructions ?? [])
        .map((line) => line.trim())
        .filter(Boolean);
    } catch (error) {
      console.error("[cardcom-document-email] care instructions lookup failed", {
        orderId: item.orderId,
        plantId,
        error: safeErrorMessage(error),
      });
    }
    sections.push({
      plantName: item.plantName.trim() || "Plant",
      careInstructions,
    });
  }
  return sections;
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
  items: OrderItem[],
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

  // Customer email is optional: orders without email still get a Cardcom document.
  const email = order.customerEmail?.trim() || undefined;
  const createDocument = deps.createDocument ?? createCardcomDocument;
  const environment = resolveEnvironment(order);

  if (order.channel === "catalog") {
    const products = buildCatalogDocumentProducts(
      items.map((item) => ({
        plantName: item.plantName,
        potName: item.potName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
      order.price,
    );
    const created = await createDocument(
      {
        dealNumber,
        name: order.fullName || "Customer",
        email,
        phone: order.phone || "",
        addressLine1: buildDeliveryAddress(order),
        productDescription: products[0]?.description ?? "Plant",
        unitCost: order.price,
        products,
        externalId: order.orderId,
      },
      { environment },
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

  const catalogPlant = order.plantId ? await getPlantById(order.plantId) : undefined;
  const isFlower = inventoryTypeOrDefault(catalogPlant?.inventoryType) === "flowers";
  const publicProductName = isFlower
    ? CARDCOM_FLOWER_LINE_ITEM_NAME
    : order.plantName || "Customer";

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
    { environment },
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
  if (before.purchaseEmailStatus === "skipped") {
    // Order without customer email: document + internal notice already handled.
    return { outcome: "skipped", error: "customer_email_skipped" };
  }

  if (before.channel !== "catalog") {
    const catalogPlant = before.plantId
      ? await getPlantById(before.plantId)
      : undefined;
    if (
      inventoryTypeOrDefault(catalogPlant?.inventoryType) === "flowers" &&
      !before.customerEmail?.trim()
    ) {
      return { outcome: "skipped", error: "flower_no_customer_email" };
    }
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
    const items =
      order.channel === "catalog" ? await getOrderItemsByOrderId(order.orderId) : [];
    const document = await resolveDocument(order, items, deps);

    const customerEmail = order.customerEmail?.trim();
    if (!customerEmail) {
      // No customer email (opt-in not chosen): document exists, skip the customer
      // email and PDF fetch, still notify Urban Plant, then mark skipped.
      const sendInternal =
        deps.sendInternalNotification ?? sendInternalOrderNotificationEmail;
      let publicPlantName =
        items.length > 0
          ? catalogCustomerProductLabel(items)
          : order.plantName || "your plant";
      if (items.length === 0) {
        try {
          const plant = order.plantId ? await getPlantById(order.plantId) : undefined;
          if (inventoryTypeOrDefault(plant?.inventoryType) === "flowers") {
            publicPlantName = CARDCOM_FLOWER_LINE_ITEM_NAME;
          }
        } catch (error) {
          console.error("[cardcom-document-email] plant lookup failed", {
            orderId: order.orderId,
            error: safeErrorMessage(error),
          });
        }
      }
      try {
        await sendInternal({
          customerEmail: "",
          fullName: order.fullName,
          plantName: publicPlantName,
          priceDisplay: formatPrice(order.price, "ILS"),
          fulfillmentMethod: order.fulfillmentMethod,
          phone: order.phone,
          address: order.address,
          apartmentOrNotes: order.apartmentOrNotes,
          locationName: order.locationName ?? undefined,
          locationAddress: order.locationAddress ?? undefined,
          orderId: order.orderId,
        });
        console.info("[purchase-email] urban_plant_send_ok", {
          role: "urban_plant",
          orderId: order.orderId,
          to: URBAN_PLANT_NOTIFICATION_TO,
        });
      } catch (error) {
        console.error("[purchase-email] urban_plant_send_failed", {
          role: "urban_plant",
          orderId: order.orderId,
          to: URBAN_PLANT_NOTIFICATION_TO,
          error: safeErrorMessage(error),
        });
      }
      const skipped = await markPurchaseEmailSkipped(order.orderId);
      if (!skipped) {
        throw new Error("Failed to mark purchase email as skipped");
      }
      return { outcome: "skipped", error: "no_customer_email" };
    }

    const fetchPdf = deps.fetchPdf ?? fetchCardcomDocumentPdf;
    const pdf = await fetchPdf(document, {
      environment: resolveEnvironment(order),
    });

    let careInstructions: string[] = [];
    let careSections: PurchaseEmailCareSection[] | undefined;
    let orderLines: PurchaseEmailOrderLine[] | undefined;
    let publicPlantName =
      items.length > 0
        ? catalogCustomerProductLabel(items)
        : order.plantName || "your plant";
    if (items.length > 0) {
      orderLines = items.map((item) => ({
        plantName: item.plantName,
        potName: item.potName,
        quantity: item.quantity,
      }));
      careSections = await loadCatalogCustomerCare(
        items,
        deps.loadPlant ?? getPlantById,
      );
    } else {
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
    }

    const sendEmail = deps.sendEmail ?? sendPurchaseEmail;
    const sendInternal =
      deps.sendInternalNotification ?? sendInternalOrderNotificationEmail;
    const priceDisplay = formatPrice(order.price, "ILS");
    const customerPayload = {
      customerEmail,
      fullName: order.fullName,
      plantName: publicPlantName,
      priceDisplay,
      fulfillmentMethod: order.fulfillmentMethod,
      ...(orderLines ? { orderLines } : {}),
      ...(careInstructions.length > 0 ? { careInstructions } : {}),
      ...(careSections?.some((section) => section.careInstructions.length > 0)
        ? { careSections }
        : {}),
      attachments: [
        {
          filename: pdf.filename,
          content: pdf.bytes,
          contentType: "application/pdf",
        },
      ],
      logOrderId: order.orderId,
    };
    const internalPayload = {
      customerEmail,
      fullName: order.fullName,
      plantName: publicPlantName,
      priceDisplay,
      fulfillmentMethod: order.fulfillmentMethod,
      phone: order.phone,
      address: order.address,
      apartmentOrNotes: order.apartmentOrNotes,
      locationName: order.locationName ?? undefined,
      locationAddress: order.locationAddress ?? undefined,
      orderId: order.orderId,
    };

    let customerSendError: string | undefined;
    try {
      await sendEmail(customerPayload);
      console.info("[purchase-email] customer_send_ok", {
        role: "customer",
        orderId: order.orderId,
        to: customerEmail,
      });
    } catch (error) {
      customerSendError = safeErrorMessage(error);
      console.error("[purchase-email] customer_send_failed", {
        role: "customer",
        orderId: order.orderId,
        to: customerEmail,
        error: customerSendError,
      });
    }

    try {
      await sendInternal(internalPayload);
      console.info("[purchase-email] urban_plant_send_ok", {
        role: "urban_plant",
        orderId: order.orderId,
        to: URBAN_PLANT_NOTIFICATION_TO,
      });
    } catch (error) {
      console.error("[purchase-email] urban_plant_send_failed", {
        role: "urban_plant",
        orderId: order.orderId,
        to: URBAN_PLANT_NOTIFICATION_TO,
        error: safeErrorMessage(error),
      });
    }

    if (customerSendError) {
      throw new Error(customerSendError);
    }

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
