/**
 * Read-only Cardcom payment status for `/payment/success` polling.
 * Never mutates order/POS, never verifies with Cardcom, never sends email.
 */

import { NextRequest, NextResponse } from "next/server";

import { readCardcomPaymentStatus } from "@/lib/cardcomPaymentStatus";

export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get("orderId");
  const body = await readCardcomPaymentStatus(orderId);
  return NextResponse.json(body);
}
