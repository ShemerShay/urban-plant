/**
 * Netlify scheduled function: every 5 minutes, call the Next.js cron route
 * that reuses expireAllStalePaymentHolds / expireStalePaymentHold.
 *
 * Requires Netlify env: CRON_SECRET, and APP_ORIGIN (or URL).
 */

const SCHEDULE = "*/5 * * * *";

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

export default async () => {
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
  const res = await fetch(target, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: "application/json",
    },
  });

  const text = await res.text();
  console.log(
    `[expire-payment-holds] ${res.status} ${text.slice(0, 500)}`,
  );

  return new Response(text, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
};

export const config = {
  schedule: SCHEDULE,
};
