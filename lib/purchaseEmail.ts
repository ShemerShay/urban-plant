/**
 * Urban Plant purchase confirmation email (shared HTML + nodemailer send).
 * Customer-facing HTML is English, left to right.
 */

import "server-only";

import nodemailer from "nodemailer";

import { englishCareInstructionForEmail } from "@/lib/careInstructionsHebrew";
import { PUBLIC_CONTACT_EMAIL } from "@/lib/publicContact";

export type PurchaseEmailFulfillment = "delivery" | "pickup";

/** Care lines for one purchased plant. Names stay as stored; lines are shown in English. */
export type PurchaseEmailCareSection = {
  plantName: string;
  careInstructions: string[];
};

/** One purchased Catalog line. Names and quantity come from stored order items. */
export type PurchaseEmailOrderLine = {
  plantName: string;
  potName?: string | null;
  quantity: number;
};

export type BuildPurchaseEmailHtmlParams = {
  fullName: string;
  plantName: string;
  priceDisplay: string;
  fulfillmentMethod: PurchaseEmailFulfillment;
  /** Existing plant care lines, shown in English. */
  careInstructions?: string[];
  /**
   * One care block per distinct plant.
   * Catalog orders pass these with orderLines. POS keeps the flat care list.
   */
  careSections?: PurchaseEmailCareSection[];
  /**
   * Catalog purchased lines. When present, the email uses one summary list.
   * POS and Flowers omit this and keep the single plant paragraph.
   */
  orderLines?: PurchaseEmailOrderLine[];
};

export type SendPurchaseEmailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

export type SendPurchaseEmailParams = {
  customerEmail: string;
  fullName: string;
  plantName: string;
  priceDisplay: string;
  fulfillmentMethod: PurchaseEmailFulfillment;
  /** Existing plant care lines, shown in English. */
  careInstructions?: string[];
  /** One care block per distinct plant on a Catalog order. */
  careSections?: PurchaseEmailCareSection[];
  /** Catalog purchased lines. Omitted for POS and Flowers. */
  orderLines?: PurchaseEmailOrderLine[];
  attachments?: SendPurchaseEmailAttachment[];
  /** Optional correlation id for server logs (never shown to the customer). */
  logOrderId?: string;
};

export type SendInternalOrderNotificationParams = {
  customerEmail: string;
  fullName: string;
  plantName: string;
  priceDisplay: string;
  fulfillmentMethod: PurchaseEmailFulfillment;
  phone?: string;
  address?: string;
  apartmentOrNotes?: string;
  locationName?: string;
  locationAddress?: string;
  orderId?: string;
};

export const PURCHASE_EMAIL_SUBJECT = "Your Urban Plant order is confirmed";
export const PURCHASE_EMAIL_REPLY_TO = PUBLIC_CONTACT_EMAIL;

/** Independent Urban Plant inbox — never CC/BCC on the customer confirmation. */
export const URBAN_PLANT_NOTIFICATION_TO = PUBLIC_CONTACT_EMAIL;
export const URBAN_PLANT_NOTIFICATION_SUBJECT = "New Urban Plant order";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeCareInstructions(
  careInstructions: string[] | undefined,
): string[] {
  if (!careInstructions?.length) return [];
  return careInstructions.map((line) => line.trim()).filter(Boolean);
}

function buildCareInstructionsBlock(
  careInstructions: string[] | undefined,
): string {
  const lines = normalizeCareInstructions(careInstructions)
    .map((line) => englishCareInstructionForEmail(line))
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";

  const items = lines
    .map(
      (line) =>
        `<li style="margin:0 0 4px;padding:0;">${escapeHtml(line)}</li>`,
    )
    .join("");

  return `<ul dir="ltr" style="margin:12px 0 0;padding:0 0 0 1.25em;font-size:15px;line-height:1.5;color:#374151;direction:ltr;text-align:left;">
    ${items}
  </ul>`;
}

function careSectionsWithLines(
  sections: PurchaseEmailCareSection[] | undefined,
): PurchaseEmailCareSection[] {
  if (!sections?.length) return [];
  return sections
    .map((section) => ({
      plantName: section.plantName.trim() || "Plant",
      careInstructions: normalizeCareInstructions(section.careInstructions),
    }))
    .filter((section) => section.careInstructions.length > 0);
}

function buildCareSectionsBlock(sections: PurchaseEmailCareSection[]): string {
  return sections
    .map((section) => {
      const care = buildCareInstructionsBlock(section.careInstructions);
      return `<p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#374151;"><strong>${escapeHtml(section.plantName)}</strong></p>
  ${care}`;
    })
    .join("\n");
}

function catalogSummaryLine(line: PurchaseEmailOrderLine): string {
  const plant = line.plantName.trim() || "Plant";
  const pot = line.potName?.trim();
  const name = pot ? `${plant} + ${pot}` : plant;
  return `${name} × ${line.quantity}`;
}

function buildCatalogOrderSummaryBlock(lines: PurchaseEmailOrderLine[]): string {
  const items = lines
    .map(
      (line) =>
        `<li style="margin:0 0 4px;padding:0;">${escapeHtml(catalogSummaryLine(line))}</li>`,
    )
    .join("");
  return `<p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#374151;">Order summary:</p>
  <ul dir="ltr" style="margin:12px 0 0;padding:0 0 0 1.25em;font-size:15px;line-height:1.5;color:#374151;direction:ltr;text-align:left;">
    ${items}
  </ul>`;
}

function buildCatalogFulfillmentSentence(method: PurchaseEmailFulfillment): string {
  const text =
    method === "pickup"
      ? "You may take the plant with you."
      : "We’ll contact you within the next 1–3 business days to coordinate delivery.";
  return `<p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#374151;">${text}</p>`;
}

function buildCatalogCareBlock(sections: PurchaseEmailCareSection[]): string {
  if (sections.length === 0) return "";
  return `<p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#374151;"><strong>Care instructions</strong></p>
  ${buildCareSectionsBlock(sections)}`;
}

/**
 * Customer confirmation HTML. English copy, left to right.
 */
export function buildPurchaseEmailHtml(params: BuildPurchaseEmailHtmlParams): string {
  const fullName = params.fullName.trim();
  const greeting = fullName ? `Hi ${escapeHtml(fullName)},` : "Hi,";
  const priceLine = params.priceDisplay
    ? `<p style="margin:12px 0 0;font-size:15px;line-height:1.5;color:#374151;">Order total: <strong>${escapeHtml(params.priceDisplay)}</strong></p>`
    : "";
  const orderLines = params.orderLines ?? [];
  if (orderLines.length > 0) {
    const catalogCare = buildCatalogCareBlock(careSectionsWithLines(params.careSections));
    return `
<!DOCTYPE html>
<html lang="en" dir="ltr">
<body dir="ltr" style="font-family:system-ui,-apple-system,sans-serif;line-height:1.6;color:#111827;max-width:560px;margin:0;padding:24px;direction:ltr;text-align:left;">
  <p style="margin:0 0 16px;font-size:16px;">${greeting}</p>
  <p style="margin:0;font-size:15px;line-height:1.5;color:#374151;">
    Thank you for your purchase from Urban Plant. Your order was received.
  </p>
  ${buildCatalogOrderSummaryBlock(orderLines)}
  ${buildCatalogFulfillmentSentence(params.fulfillmentMethod)}
  ${catalogCare}
  ${priceLine}
  <p style="margin:24px 0 0;font-size:14px;color:#6b7280;">— Urban Plant</p>
</body>
</html>
`.trim();
  }

  const labeledCare = careSectionsWithLines(params.careSections);
  const careBlock =
    labeledCare.length > 0 ? "" : buildCareInstructionsBlock(params.careInstructions);
  const careSectionsBlock =
    labeledCare.length > 0 ? buildCareSectionsBlock(labeledCare) : "";
  const plantBlock =
    params.fulfillmentMethod === "pickup"
      ? `<p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#374151;">
    <strong>${escapeHtml(params.plantName)}</strong>
  </p>
  ${careBlock}
  <p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#374151;">
    You may take the plant with you.
  </p>`
      : `<p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#374151;">
    <strong>${escapeHtml(params.plantName)}</strong> — we’ll contact you within the next 1–3 business days to coordinate delivery.
  </p>
  ${careBlock}`;

  return `
<!DOCTYPE html>
<html lang="en" dir="ltr">
<body dir="ltr" style="font-family:system-ui,-apple-system,sans-serif;line-height:1.6;color:#111827;max-width:560px;margin:0;padding:24px;direction:ltr;text-align:left;">
  <p style="margin:0 0 16px;font-size:16px;">${greeting}</p>
  <p style="margin:0;font-size:15px;line-height:1.5;color:#374151;">
    Thank you for your purchase from Urban Plant. Your order was received.
  </p>
  ${plantBlock}
  ${careSectionsBlock}
  ${priceLine}
  <p style="margin:24px 0 0;font-size:14px;color:#6b7280;">— Urban Plant</p>
</body>
</html>
`.trim();
}

export function isValidPurchaseEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function requireGmailAuth(): { gmailUser: string; gmailAppPassword: string } {
  const gmailUser = process.env.GMAIL_USER?.trim();
  if (!gmailUser) {
    throw new Error("Email service is not configured");
  }

  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD?.trim();
  if (!gmailAppPassword) {
    throw new Error("Email sender is not configured");
  }

  return { gmailUser, gmailAppPassword };
}

function mailErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 500);
  }
  return "Email send failed";
}

/**
 * Internal staff HTML — never used for the customer confirmation.
 */
export function buildInternalOrderNotificationHtml(
  params: SendInternalOrderNotificationParams,
): string {
  const row = (label: string, value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return "";
    return `<tr>
      <td style="padding:6px 12px 6px 0;vertical-align:top;color:#6b7280;white-space:nowrap;">${escapeHtml(label)}</td>
      <td style="padding:6px 0;vertical-align:top;color:#111827;">${escapeHtml(trimmed)}</td>
    </tr>`;
  };

  const fulfillment =
    params.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery";
  const addressLine = [params.address?.trim(), params.apartmentOrNotes?.trim()]
    .filter(Boolean)
    .join(", ");
  const locationLine = [params.locationName?.trim(), params.locationAddress?.trim()]
    .filter(Boolean)
    .join(" — ");

  return `
<!DOCTYPE html>
<html>
<body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.6;color:#111827;max-width:560px;margin:0;padding:24px;">
  <p style="margin:0 0 16px;font-size:16px;">A new Urban Plant order was received.</p>
  <table style="border-collapse:collapse;font-size:15px;line-height:1.5;">
    ${row("Order ID", params.orderId ?? "")}
    ${row("Customer name", params.fullName)}
    ${row("Customer email", params.customerEmail)}
    ${row("Phone", params.phone ?? "")}
    ${row("Plant", params.plantName)}
    ${row("Order total", params.priceDisplay)}
    ${row("Fulfillment", fulfillment)}
    ${row("Delivery address", addressLine)}
    ${row("Location", locationLine)}
  </table>
  <p style="margin:24px 0 0;font-size:14px;color:#6b7280;">This notice was sent only to Urban Plant. The customer was not copied.</p>
</body>
</html>
`.trim();
}

/**
 * Send the Urban Plant confirmation email (optional PDF attachment).
 * Same sender, subject, HTML, pickup/delivery text as the public route.
 * Recipient is the customer only — never CC or BCC.
 */
export async function sendPurchaseEmail(
  params: SendPurchaseEmailParams,
): Promise<{ messageId: string | null }> {
  const customerEmail = params.customerEmail.trim();
  if (!customerEmail || !isValidPurchaseEmailAddress(customerEmail)) {
    throw new Error("Valid customerEmail is required");
  }

  const { gmailUser, gmailAppPassword } = requireGmailAuth();

  const plantName = params.plantName.trim() || "your plant";
  const fullName = params.fullName.trim();
  const priceDisplay = params.priceDisplay.trim();
  const fulfillmentMethod =
    params.fulfillmentMethod === "pickup" ? "pickup" : "delivery";
  const careInstructions = normalizeCareInstructions(params.careInstructions);
  const careSections = careSectionsWithLines(params.careSections);
  const orderLines = params.orderLines?.length ? params.orderLines : undefined;
  const logOrderId = params.logOrderId?.trim() || undefined;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: gmailUser,
      pass: gmailAppPassword,
    },
  });

  try {
    const info = await transporter.sendMail({
      from: `"Urban Plant" <${gmailUser}>`,
      to: customerEmail,
      replyTo: PURCHASE_EMAIL_REPLY_TO,
      subject: PURCHASE_EMAIL_SUBJECT,
      html: buildPurchaseEmailHtml({
        fullName,
        plantName,
        priceDisplay,
        fulfillmentMethod,
        ...(careInstructions.length > 0 ? { careInstructions } : {}),
        ...(careSections.length > 0 ? { careSections } : {}),
        ...(orderLines ? { orderLines } : {}),
      }),
      ...(params.attachments && params.attachments.length > 0
        ? {
            attachments: params.attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              contentType: a.contentType,
            })),
          }
        : {}),
    });
    return { messageId: info.messageId ?? null };
  } catch (error) {
    console.error("[purchase-email] customer_send_failed", {
      role: "customer",
      to: customerEmail,
      ...(logOrderId ? { orderId: logOrderId } : {}),
      error: mailErrorMessage(error),
    });
    throw error;
  }
}

/**
 * Separate Urban Plant notification. Independent send — never CC/BCC the customer.
 */
export async function sendInternalOrderNotificationEmail(
  params: SendInternalOrderNotificationParams,
): Promise<{ messageId: string | null }> {
  const to = URBAN_PLANT_NOTIFICATION_TO.trim();
  if (!to || !isValidPurchaseEmailAddress(to)) {
    throw new Error("Urban Plant notification address is not configured");
  }

  const { gmailUser, gmailAppPassword } = requireGmailAuth();
  const orderId = params.orderId?.trim() || undefined;
  const customerEmail = params.customerEmail.trim();
  const plantName = params.plantName.trim() || "your plant";
  const fullName = params.fullName.trim();
  const priceDisplay = params.priceDisplay.trim();
  const fulfillmentMethod =
    params.fulfillmentMethod === "pickup" ? "pickup" : "delivery";

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: gmailUser,
      pass: gmailAppPassword,
    },
  });

  try {
    const info = await transporter.sendMail({
      from: `"Urban Plant" <${gmailUser}>`,
      to,
      ...(customerEmail && isValidPurchaseEmailAddress(customerEmail)
        ? { replyTo: customerEmail }
        : {}),
      subject: orderId
        ? `${URBAN_PLANT_NOTIFICATION_SUBJECT} (${orderId})`
        : URBAN_PLANT_NOTIFICATION_SUBJECT,
      html: buildInternalOrderNotificationHtml({
        ...params,
        customerEmail,
        fullName,
        plantName,
        priceDisplay,
        fulfillmentMethod,
        ...(orderId ? { orderId } : {}),
      }),
    });
    return { messageId: info.messageId ?? null };
  } catch (error) {
    console.error("[purchase-email] urban_plant_send_failed", {
      role: "urban_plant",
      to,
      ...(orderId ? { orderId } : {}),
      error: mailErrorMessage(error),
    });
    throw error;
  }
}
