import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function buildEmailHtml(params: {
  fullName: string;
  plantName: string;
  priceDisplay: string;
  fulfillmentMethod: "delivery" | "pickup";
}): string {
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const rec = body as Record<string, unknown>;
  const customerEmail =
    typeof rec.customerEmail === "string" ? rec.customerEmail.trim() : "";

  if (!customerEmail || !isValidEmail(customerEmail)) {
    return NextResponse.json(
      { error: "Valid customerEmail is required" },
      { status: 400 },
    );
  }

  const gmailUser = process.env.GMAIL_USER?.trim();
  if (!gmailUser) {
    return NextResponse.json(
      { error: "Email service is not configured" },
      { status: 503 },
    );
  }

  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD?.trim();
  if (!gmailAppPassword) {
    return NextResponse.json(
      { error: "Email sender is not configured" },
      { status: 503 },
    );
  }

  const plantName =
    typeof rec.plantName === "string" && rec.plantName.trim()
      ? rec.plantName.trim()
      : "your plant";
  const fullName =
    typeof rec.fullName === "string" ? rec.fullName.trim() : "";
  const priceDisplay =
    typeof rec.priceDisplay === "string" ? rec.priceDisplay.trim() : "";
  const fulfillmentMethodRaw =
    typeof rec.fulfillmentMethod === "string" ? rec.fulfillmentMethod.trim() : "";
  const fulfillmentMethod =
    fulfillmentMethodRaw === "pickup" ? "pickup" : "delivery";

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
      replyTo: "beherha@gmail.com",
      subject: "Your Urban Plant order is confirmed",
      html: buildEmailHtml({
        fullName,
        plantName,
        priceDisplay,
        fulfillmentMethod,
      }),
    });

    return NextResponse.json({ ok: true, id: info.messageId ?? null });
  } catch (error) {
    console.error("[send-purchase-email]", error);
    const message =
      error instanceof Error ? error.message : "Failed to send confirmation email";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
