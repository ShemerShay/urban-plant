/**
 * Scheduled hold cleanup entry point (Netlify cron → POST).
 * Reuses {@link expireAllStalePaymentHolds} / {@link expireStalePaymentHold}.
 * Auth: Authorization Bearer CRON_SECRET (required).
 *
 * Cron is background hygiene only — customer/Admin flows also lazy-expire.
 */

import { NextRequest, NextResponse } from "next/server";

import { expireAllStalePaymentHolds } from "@/lib/paymentHoldExpiry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorizeCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization")?.trim() ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return false;
  const token = header.slice("bearer ".length).trim();
  return token.length > 0 && token === secret;
}

async function runExpire(): Promise<NextResponse> {
  if (!process.env.CRON_SECRET?.trim()) {
    console.error("[cron/expire-payment-holds] CRON_SECRET is not configured");
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  }

  console.log("[cron/expire-payment-holds] start");
  const result = await expireAllStalePaymentHolds();
  console.log(
    `[cron/expire-payment-holds] done candidates=${result.candidateCount} released=${result.expiredCount}`,
  );
  return NextResponse.json({
    ok: true,
    candidateCount: result.candidateCount,
    expiredCount: result.expiredCount,
    expiredPosSpotIds: result.expiredPosSpotIds,
  });
}

export async function POST(request: NextRequest) {
  if (!authorizeCron(request)) {
    console.error("[cron/expire-payment-holds] unauthorized");
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    return await runExpire();
  } catch (error) {
    console.error("[cron/expire-payment-holds] failed", error);
    return NextResponse.json(
      { ok: false, error: "Expire failed" },
      { status: 500 },
    );
  }
}

/** Allow GET with the same Bearer auth (handy for manual Netlify checks). */
export async function GET(request: NextRequest) {
  return POST(request);
}
