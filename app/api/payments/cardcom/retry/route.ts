/**
 * Resume-holder retry: new Cardcom LowProfile for the same pending_payment order.
 * Never creates a second completed sale. Never releases POS without webhook/admin.
 */

import { NextRequest, NextResponse } from "next/server";

import { retryCardcomPayment } from "@/lib/retryCardcomPayment";

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
  const result = await retryCardcomPayment({
    orderId: cleanString(record.orderId),
    resumeToken: cleanString(record.resumeToken),
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
    { status: 200 },
  );
}
