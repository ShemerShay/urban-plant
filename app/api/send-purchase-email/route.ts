import { NextRequest, NextResponse } from "next/server";

import {
  isValidPurchaseEmailAddress,
  sendInternalOrderNotificationEmail,
  sendPurchaseEmail,
  URBAN_PLANT_NOTIFICATION_TO,
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

  const sharedFields = {
    customerEmail,
    fullName,
    plantName,
    priceDisplay,
    fulfillmentMethod: fulfillmentMethod as "pickup" | "delivery",
  };

  let customerMessageId: string | null = null;
  let customerError: unknown;
  try {
    const info = await sendPurchaseEmail(sharedFields);
    customerMessageId = info.messageId ?? null;
    console.info("[purchase-email] customer_send_ok", {
      role: "customer",
      to: customerEmail,
    });
  } catch (error) {
    customerError = error;
    console.error("[send-purchase-email] customer_send_failed", error);
  }

  try {
    await sendInternalOrderNotificationEmail(sharedFields);
    console.info("[purchase-email] urban_plant_send_ok", {
      role: "urban_plant",
      to: URBAN_PLANT_NOTIFICATION_TO,
    });
  } catch (error) {
    console.error("[send-purchase-email] urban_plant_send_failed", error);
  }

  if (customerError) {
    const message =
      customerError instanceof Error
        ? customerError.message
        : "Failed to send confirmation email";
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

  return NextResponse.json({ ok: true, id: customerMessageId });
}
