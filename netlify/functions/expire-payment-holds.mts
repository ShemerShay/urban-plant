/**
 * Netlify scheduled function: every 5 minutes, call the Next.js cron route
 * that reuses expireAllStalePaymentHolds / expireStalePaymentHold.
 *
 * Requires Netlify env: CRON_SECRET, and APP_ORIGIN (or URL).
 * Non-2xx responses are returned as-is (do not report success on failure).
 *
 * Schedule must be a string literal here (and/or in netlify.toml). A variable
 * reference is not statically extractable and can leave schedule unregistered.
 */

import type { Config } from "@netlify/functions";

function siteOrigin(): string | null {
  const raw =
    process.env.APP_ORIGIN?.trim() ||
    process.env.URL?.trim() ||
    process.env.DEPLOY_PRIME_URL?.trim() ||
    "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export default async (_request: Request) => {
  console.log("[expire-payment-holds] scheduled function start");

  const origin = siteOrigin();
  const secret = process.env.CRON_SECRET?.trim();

  if (!origin || !secret) {
    console.error("[expire-payment-holds] missing APP_ORIGIN/URL or CRON_SECRET");
    return new Response(
      JSON.stringify({
        ok: false,
        error: "missing APP_ORIGIN/URL or CRON_SECRET",
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  const target = `${origin}/api/cron/expire-payment-holds`;
  let res: Response;
  try {
    res = await fetch(target, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: "application/json",
      },
    });
  } catch (error) {
    console.error("[expire-payment-holds] fetch failed", error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: "fetch to cron route failed",
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  const text = await res.text();
  console.log(
    `[expire-payment-holds] cron route status=${res.status} body=${text.slice(0, 500)}`,
  );

  if (!res.ok) {
    console.error(
      `[expire-payment-holds] cleanup failed with HTTP ${res.status}`,
    );
  }

  // Propagate non-2xx so Netlify does not treat a failed cleanup as success.
  return new Response(text || JSON.stringify({ ok: false, error: "empty cron response" }), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
};

// String literal required — Netlify extracts this at build time.
export const config: Config = {
  schedule: "*/5 * * * *",
};
