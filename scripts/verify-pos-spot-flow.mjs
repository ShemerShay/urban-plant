/**
 * Validates POS Spot → Offer → Product resolution (no UI).
 * Run: node scripts/verify-pos-spot-flow.mjs
 */

import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const PLANTS = {
  monstera: "Monstera Deliciosa",
  alocasia: "Alocasia",
  asparagus: "Asparagus fern",
  "olive-01": "Mediterranean Olive",
};

async function readJson(relPath) {
  const raw = await readFile(path.join(root, relPath), "utf-8");
  return JSON.parse(raw);
}

function resolveChain(spotSlug, posSpots, offers) {
  const posSpot =
    posSpots.find((s) => s.spotSlug === spotSlug || s.id === spotSlug) ?? null;
  if (!posSpot) return { error: `POS Spot not found for slug: ${spotSlug}` };
  const offer = offers.find((o) => o.id === posSpot.currentOfferId) ?? null;
  if (!offer) return { error: `Offer not found: ${posSpot.currentOfferId}` };
  const productName = PLANTS[offer.productId];
  if (!productName) return { error: `Product not found: ${offer.productId}` };
  return {
    posSpot,
    offer,
    product: { id: offer.productId, name: productName },
  };
}

const spotSlug = "partner-01-asparagus";
const [posSpots, offers] = await Promise.all([
  readJson("data/pos-spots.json"),
  readJson("data/offers.json"),
]);

console.log("\n--- POS flow verification ---\n");
console.log(`URL: /pos/${spotSlug}\n`);

const chain = resolveChain(spotSlug, posSpots, offers);
if (chain.error) {
  console.error("FAIL:", chain.error);
  process.exit(1);
}

console.log("[POS SPOT]", chain.posSpot);
console.log("[currentOfferId]", chain.posSpot.currentOfferId);
console.log("[OFFER]", chain.offer);
console.log("[PRODUCT]", chain.product);

const altOfferId = "offer-monstera";
const swappedSpot = { ...chain.posSpot, currentOfferId: altOfferId };
const swapped = resolveChain(spotSlug, [swappedSpot, ...posSpots.filter((s) => s.id !== chain.posSpot.id)], offers);

console.log("\n--- currentOfferId swap test (same spotSlug) ---\n");
console.log(`If currentOfferId → ${altOfferId}:`);
console.log("[OFFER]", swapped.offer);
console.log("[PRODUCT]", swapped.product);
console.log("\nURL unchanged:", `/pos/${spotSlug}`);
console.log("Product changed:", chain.product.id, "→", swapped.product.id);
console.log("\nOK\n");
