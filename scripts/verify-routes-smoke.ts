/**
 * HTTP smoke: existing App Router pages after `npm run dev`.
 * Does not change Shop, Partner, POS, or payment logic.
 *
 * Run: npm run verify:routes-smoke
 * Requires the local app at SMOKE_ORIGIN (default http://127.0.0.1:3000).
 */

import assert from "node:assert/strict";

import { ADMIN_COOKIE, ADMIN_COOKIE_VALUE } from "../lib/adminAuth.ts";
import { routes } from "../lib/routes.ts";

const origin = (process.env.SMOKE_ORIGIN ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const cookie = `${ADMIN_COOKIE}=${ADMIN_COOKIE_VALUE}`;
const FETCH_MS = 90_000;

type PosSpotRow = {
  id?: string;
  spotSlug?: string;
  status?: string;
  currentOfferId?: string;
  plantVariantId?: string;
  paymentHoldStartedAt?: string;
  paymentHoldAttemptId?: string;
  offerPlacedAt?: string;
};

type SpotOfferRow = { id?: string; inventoryType?: string | null };

function isCustomerNotFoundPage(status: number, html: string): boolean {
  if (status !== 404) return false;
  return (
    html.includes("This page") ||
    html.includes("isn’t available") ||
    html.includes("אינו זמין") ||
    html.includes("__next_error__")
  );
}

function occupancyFingerprint(spot: PosSpotRow): string {
  return JSON.stringify({
    id: spot.id ?? null,
    spotSlug: spot.spotSlug ?? null,
    status: spot.status ?? null,
    currentOfferId: spot.currentOfferId ?? null,
    plantVariantId: spot.plantVariantId ?? null,
    paymentHoldStartedAt: spot.paymentHoldStartedAt ?? null,
    paymentHoldAttemptId: spot.paymentHoldAttemptId ?? null,
    offerPlacedAt: spot.offerPlacedAt ?? null,
  });
}

async function fetchText(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; text: string; contentType: string }> {
  const res = await fetch(`${origin}${path}`, {
    redirect: "manual",
    ...init,
    signal: AbortSignal.timeout(FETCH_MS),
    headers: {
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  return {
    status: res.status,
    text,
    contentType: res.headers.get("content-type") ?? "",
  };
}

async function main(): Promise<void> {
  let shop;
  try {
    shop = await fetchText(routes.shop.index());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Dev server is not reachable at ${origin} (${message}). Start it with npm run dev.`);
  }
  assert.equal(shop.status, 200, `/shop returned ${shop.status}`);
  assert.equal(isCustomerNotFoundPage(shop.status, shop.text), false);
  const plantHrefs = [
    ...new Set(
      [...shop.text.matchAll(/href="(\/shop\/plants\/[^"]+)"/g)].map((match) => match[1]),
    ),
  ];
  assert.ok(plantHrefs.length > 0, "/shop did not render any plant links");

  for (const plantPath of plantHrefs.slice(0, 3)) {
    const plant = await fetchText(plantPath);
    assert.equal(plant.status, 200, `${plantPath} returned ${plant.status}`);
    assert.equal(isCustomerNotFoundPage(plant.status, plant.text), false);
    const plantTitle = plant.text.match(/<h1[^>]*>([^<]+)<\/h1>/);
    assert.ok(plantTitle?.[1]?.trim(), `${plantPath} did not render a plant name`);
  }

  const cart = await fetchText("/cart");
  assert.equal(cart.status, 404, `/cart returned ${cart.status}`);
  assert.equal(isCustomerNotFoundPage(cart.status, cart.text), true);

  const shopCheckout = await fetchText(routes.shop.checkout());
  assert.equal(shopCheckout.status, 200, `${routes.shop.checkout()} returned ${shopCheckout.status}`);
  assert.equal(isCustomerNotFoundPage(shopCheckout.status, shopCheckout.text), false);
  assert.equal(shopCheckout.text.includes('data-page="shop-checkout"'), true);
  assert.equal(shopCheckout.text.includes('data-page="checkout-page"'), false);
  assert.equal(shopCheckout.text.includes("You are ordering flowers"), false);

  const missingPlant = await fetchText("/shop/plants/not-a-real-plant-id-zzzz");
  assert.equal(missingPlant.status, 404, "missing plant must 404");
  assert.equal(isCustomerNotFoundPage(missingPlant.status, missingPlant.text), true);

  const plantId = decodeURIComponent(plantHrefs[0]!.split("/").pop() ?? "");
  const apiPlant = await fetchText(routes.api.plant(plantId));
  assert.equal(apiPlant.status, 405, `${routes.api.plant(plantId)} expected GET 405, got ${apiPlant.status}`);

  const brands = await fetchText(routes.api.partnerBrands(), {
    headers: { cookie },
  });
  assert.equal(brands.status, 200, `/api/partner-brands returned ${brands.status}`);
  const parsed = JSON.parse(brands.text) as { partners?: { id?: string }[] };
  const partnerIds = [
    ...new Set((parsed.partners ?? []).map((row) => row.id?.trim()).filter(Boolean) as string[]),
  ];
  assert.ok(partnerIds.length > 0, "no partner id from /api/partner-brands");
  for (const partnerId of partnerIds.slice(0, 2)) {
    const partner = await fetchText(routes.admin.partner(partnerId), {
      headers: { cookie },
    });
    assert.equal(partner.status, 200, `${routes.admin.partner(partnerId)} returned ${partner.status}`);
    assert.equal(isCustomerNotFoundPage(partner.status, partner.text), false);
  }

  const missingPartner = await fetchText("/admin/partners/not-a-real-partner-zzzz", {
    headers: { cookie },
  });
  assert.equal(missingPartner.status, 404, "missing partner must 404");
  assert.equal(isCustomerNotFoundPage(missingPartner.status, missingPartner.text), true);

  const spotsRes = await fetchText(routes.api.posSpots(), { headers: { cookie } });
  assert.equal(spotsRes.status, 200, `/api/pos-spots returned ${spotsRes.status}`);
  const spotsPayload = JSON.parse(spotsRes.text) as {
    posSpots?: PosSpotRow[];
    spotOffers?: SpotOfferRow[];
  };
  const offerType = new Map(
    (spotsPayload.spotOffers ?? []).map((offer) => [offer.id, offer.inventoryType ?? null]),
  );
  const plantSpot = (spotsPayload.posSpots ?? []).find((spot) => {
    const offerId = spot.currentOfferId?.trim();
    if (!offerId || !spot.id || !spot.spotSlug) return false;
    if (spot.status === "held_for_payment") return false;
    return offerType.get(offerId) === "plants";
  });
  assert.ok(plantSpot?.id && plantSpot.spotSlug, "no non-flower plant POS spot available for smoke");
  const before = occupancyFingerprint(plantSpot);
  const checkoutPath = routes.pos.checkout(plantSpot.spotSlug);
  const checkout = await fetchText(checkoutPath);
  assert.equal(checkout.status, 200, `${checkoutPath} returned ${checkout.status}`);
  assert.equal(isCustomerNotFoundPage(checkout.status, checkout.text), false);
  assert.equal(
    checkout.text.includes("You are ordering flowers"),
    false,
    `${checkoutPath} rendered flower checkout (would start payment)`,
  );
  assert.ok(
    checkout.text.includes('data-inventory-type="plants"') ||
      checkout.text.includes('data-pos-empty="true"'),
    `${checkoutPath} was not a plant checkout page`,
  );

  const afterRes = await fetchText(routes.api.posSpot(plantSpot.id), { headers: { cookie } });
  assert.equal(afterRes.status, 200, `${routes.api.posSpot(plantSpot.id)} returned ${afterRes.status}`);
  const afterPayload = JSON.parse(afterRes.text) as { posSpot?: PosSpotRow };
  assert.ok(afterPayload.posSpot, "POS spot missing after checkout GET");
  assert.equal(
    occupancyFingerprint(afterPayload.posSpot),
    before,
    "checkout GET mutated POS occupancy / hold fields",
  );

  console.log("verify-routes-smoke: ok", {
    origin,
    shop: routes.shop.index(),
    cart: "/cart",
    cartStatus: 404,
    plant: plantHrefs[0],
    apiPlant: routes.api.plant(plantId),
    apiPlantStatus: 405,
    partners: partnerIds.slice(0, 2).map((id) => routes.admin.partner(id)),
    checkout: checkoutPath,
    posSpotId: plantSpot.id,
    posUnchanged: true,
  });
}

main().catch((error) => {
  console.error("verify-routes-smoke FAILED", error);
  process.exit(1);
});
