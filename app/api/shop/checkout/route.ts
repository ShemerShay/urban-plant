/**
 * Catalog payment start. Delegates to the existing preparation path.
 * Does not finalize, send email, or create a second attempt on retry.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  startCatalogCardcomPayment,
  type CatalogCheckoutLineInput,
} from "@/lib/catalogPaymentPrep";
import { INTERNAL_COOKIE_NAME, isInternalAnalyticsSignal } from "@/lib/internalTraffic";

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
  const result = await startCatalogCardcomPayment({
    lines: record.lines as CatalogCheckoutLineInput[],
    fullName: cleanString(record.fullName),
    phone: cleanString(record.phone),
    emailOptIn: record.emailOptIn as boolean,
    customerEmail: cleanString(record.customerEmail),
    deliveryStreet: cleanString(record.deliveryStreet),
    deliveryHouseNumber: cleanString(record.deliveryHouseNumber),
    apartmentOrNotes: cleanString(record.apartmentOrNotes),
    isInternal:
      record.isInternal === true ||
      isInternalAnalyticsSignal({
        cookieValue: request.cookies.get(INTERNAL_COOKIE_NAME)?.value ?? null,
      }) ||
      false,
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
      attemptId: result.attemptId,
      lowProfileId: result.lowProfileId,
      paymentUrl: result.paymentUrl,
    },
    { status: 201 },
  );
}
