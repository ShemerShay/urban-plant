/**
 * Cardcom LowProfile webhook (Phase E).
 * POST application/json body = Swagger LowProfileResult.
 * Payload is not proof of payment — GetLpResult verifies.
 * Public route (no admin auth). Does not wire CheckoutForm or send email.
 */

import { NextRequest, NextResponse } from "next/server";

import { processCardcomWebhook } from "@/lib/processCardcomWebhook";

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return NextResponse.json(
      { ok: false, error: "Expected application/json" },
      { status: 415 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await processCardcomWebhook(body);
  return NextResponse.json(result.body, { status: result.httpStatus });
}
