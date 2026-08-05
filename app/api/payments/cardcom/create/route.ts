/**
 * Payment-start: pending order + POS hold + Cardcom LowProfile/Create.
 * Used by CheckoutForm first payment and admin Cardcom test.
 * Does not finalize payment (webhook + GetLpResult) or send email.
 */

import { NextRequest, NextResponse } from "next/server";

import type { FulfillmentMethod } from "@/lib/orderTypes";
import { startCardcomPaymentPrep } from "@/lib/startCardcomPaymentPrep";

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

  const record = body as Record<string, unknown>;
  const fulfillmentMethod: FulfillmentMethod =
    record.fulfillmentMethod === "pickup" ? "pickup" : "delivery";

  const result = await startCardcomPaymentPrep({
    plantId: cleanString(record.plantId),
    spotSlug: cleanString(record.spotSlug),
    fullName: cleanString(record.fullName),
    customerEmail: cleanString(record.customerEmail),
    phone: cleanString(record.phone),
    fulfillmentMethod,
    ...(fulfillmentMethod === "delivery"
      ? {
          deliveryStreet: cleanString(record.deliveryStreet),
          deliveryHouseNumber: cleanString(record.deliveryHouseNumber),
          apartmentOrNotes: cleanString(record.apartmentOrNotes),
        }
      : {}),
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, code: result.code },
      { status: result.httpStatus },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      orderId: result.orderId,
      lowProfileId: result.lowProfileId,
      paymentUrl: result.paymentUrl,
    },
    { status: 201 },
  );
}
