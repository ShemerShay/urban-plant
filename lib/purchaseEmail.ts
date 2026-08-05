/**
 * Urban Plant purchase confirmation email (shared HTML + nodemailer send).
 * Keep copy identical to the historical send-purchase-email route.
 */

import "server-only";

import nodemailer from "nodemailer";

export type PurchaseEmailFulfillment = "delivery" | "pickup";

export type BuildPurchaseEmailHtmlParams = {
  fullName: string;
  plantName: string;
  priceDisplay: string;
  fulfillmentMethod: PurchaseEmailFulfillment;
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
  attachments?: SendPurchaseEmailAttachment[];
};

export const PURCHASE_EMAIL_SUBJECT = "Your Urban Plant order is confirmed";
export const PURCHASE_EMAIL_REPLY_TO = "beherha@gmail.com";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Existing Urban Plant confirmation HTML — do not change copy.
 */
export function buildPurchaseEmailHtml(params: BuildPurchaseEmailHtmlParams): string {
  const greeting = params.fullName ? `Hi ${escapeHtml(params.fullName)},` : "Hi,";
  const priceLine = params.priceDisplay
    ? `<p style="margin:12px 0 0;font-size:15px;line-height:1.5;color:#374151;">Order total: <strong>${escapeHtml(params.priceDisplay)}</strong></p>`
    : "";
  const plantBlock =
    params.fulfillmentMethod === "pickup"
      ? `<p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#374151;">
    <strong>${escapeHtml(params.plantName)}</strong>
  </p>
  <p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#374151;">
    You may take the plant with you.
  </p>`
      : `<p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#374151;">
    <strong>${escapeHtml(params.plantName)}</strong> — we’ll contact you within the next 1–3 business days to coordinate delivery.
  </p>`;

  return `
<!DOCTYPE html>
<html>
<body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.6;color:#111827;max-width:560px;margin:0;padding:24px;">
  <p style="margin:0 0 16px;font-size:16px;">${greeting}</p>
  <p style="margin:0;font-size:15px;line-height:1.5;color:#374151;">
    Thank you for your purchase from Urban Plant. Your order was received.
  </p>
  ${plantBlock}
  ${priceLine}
  <p style="margin:24px 0 0;font-size:14px;color:#6b7280;">— Urban Plant</p>
</body>
</html>
`.trim();
}

export function isValidPurchaseEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Send the Urban Plant confirmation email (optional PDF attachment).
 * Same sender, subject, HTML, pickup/delivery text as the public route.
 */
export async function sendPurchaseEmail(
  params: SendPurchaseEmailParams,
): Promise<{ messageId: string | null }> {
  const customerEmail = params.customerEmail.trim();
  if (!customerEmail || !isValidPurchaseEmailAddress(customerEmail)) {
    throw new Error("Valid customerEmail is required");
  }

  const gmailUser = process.env.GMAIL_USER?.trim();
  if (!gmailUser) {
    throw new Error("Email service is not configured");
  }

  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD?.trim();
  if (!gmailAppPassword) {
    throw new Error("Email sender is not configured");
  }

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
}
