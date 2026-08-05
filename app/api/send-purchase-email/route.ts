import { NextRequest, NextResponse } from "next/server";

import {
  isValidPurchaseEmailAddress,
  sendPurchaseEmail,
} from "@/lib/purchaseEmail";

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

  if (!customerEmail || !isValidPurchaseEmailAddress(customerEmail)) {
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

  try {
    const info = await sendPurchaseEmail({
      customerEmail,
      fullName,
      plantName,
      priceDisplay,
      fulfillmentMethod,
    });

    return NextResponse.json({ ok: true, id: info.messageId ?? null });
  } catch (error) {
    console.error("[send-purchase-email]", error);
    const message =
      error instanceof Error ? error.message : "Failed to send confirmation email";
    if (
      message === "Email service is not configured" ||
      message === "Email sender is not configured"
    ) {
      return NextResponse.json({ error: message }, { status: 503 });
    }
    if (message === "Valid customerEmail is required") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
