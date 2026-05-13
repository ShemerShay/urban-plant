import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function buildEmailHtml(params: {
  fullName: string;
  plantName: string;
  priceDisplay: string;
  orderId: string;
}): string {
  const greeting = params.fullName ? `Hi ${escapeHtml(params.fullName)},` : "Hi,";
  const priceLine = params.priceDisplay
    ? `<p style="margin:12px 0 0;font-size:15px;line-height:1.5;color:#374151;">Order total: <strong>${escapeHtml(params.priceDisplay)}</strong></p>`
    : "";
  const orderRef = params.orderId
    ? `<p style="margin:8px 0 0;font-size:13px;color:#6b7280;">Reference: ${escapeHtml(params.orderId)}</p>`
    : "";

  return `
<!DOCTYPE html>
<html>
<body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.6;color:#111827;max-width:560px;margin:0;padding:24px;">
  <p style="margin:0 0 16px;font-size:16px;">${greeting}</p>
  <p style="margin:0;font-size:15px;line-height:1.5;color:#374151;">
    Thank you for your purchase from Urban Plant. Your order was received.
  </p>
  <p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#374151;">
    <strong>${escapeHtml(params.plantName)}</strong> — we’ll contact you soon with pickup or delivery details.
  </p>
  ${priceLine}
  ${orderRef}
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

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Email service is not configured" },
      { status: 503 },
    );
  }

  const from = process.env.RESEND_FROM?.trim();
  if (!from) {
    return NextResponse.json(
      { error: "Email sender is not configured" },
      { status: 503 },
    );
  }

  const plantName =
    typeof rec.plantName === "string" && rec.plantName.trim()
      ? rec.plantName.trim()
      : "your plant";
  const orderId =
    typeof rec.orderId === "string" && rec.orderId.trim() ? rec.orderId.trim() : "";
  const fullName =
    typeof rec.fullName === "string" ? rec.fullName.trim() : "";
  const priceDisplay =
    typeof rec.priceDisplay === "string" ? rec.priceDisplay.trim() : "";

  const resend = new Resend(apiKey);

  const { data, error } = await resend.emails.send({
    from,
    to: customerEmail,
    subject: "Your Urban Plant order is confirmed",
    html: buildEmailHtml({
      fullName,
      plantName,
      priceDisplay,
      orderId,
    }),
  });

  if (error) {
    console.error("[send-purchase-email]", error);
    return NextResponse.json(
      { error: error.message ?? "Failed to send confirmation email" },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, id: data?.id ?? null });
}
