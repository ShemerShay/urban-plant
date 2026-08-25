/**
 * Flowers Phase 1 offline checks: product model, offers split, QR/checkout, payment policy.
 * Run: npx tsx scripts/verify-flowers-phase1.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CARDCOM_FLOWER_LINE_ITEM_NAME,
  cardcomLineItemName,
  posRequiresPaymentHold,
  posStatusAfterSuccessfulPayment,
} from "../lib/inventoryType";
import {
  defaultCheckoutFulfillment,
  hideCheckoutPickupOption,
  isCheckoutDeliveryDisabled,
} from "../lib/checkoutFulfillment";
import { posAllowsVerifiedPaymentFinalize } from "../lib/posSpotHold";
import { parsePlantBody } from "../lib/plantValidation";

const root = process.cwd();
function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const plantRequired = {
  id: "verify-plant-required",
  name: "Monstera",
  subtitle: "A leafy plant",
  description: "A description",
  supplierPrice: 20,
  currency: "ILS",
  images: ["https://example.com/p.jpg"],
  labels: ["indoor"],
  light: "Medium light",
  water: "Weekly",
  difficulty: "Easy",
  location: "Indoor",
  petFriendly: false,
  careInstructions: ["Water weekly"],
  inventoryType: "plants",
};

const plantOk = parsePlantBody(plantRequired, { requireId: true });
assert.equal(plantOk.ok, true);

const plantMissingSubtitle = parsePlantBody(
  { ...plantRequired, subtitle: "" },
  { requireId: true },
);
assert.equal(plantMissingSubtitle.ok, false);

const flowerMinimal = parsePlantBody(
  {
    id: "verify-flower-minimal",
    name: "באנץ פרחים ירוקים",
    supplierPrice: 20,
    currency: "ILS",
    inventoryType: "flowers",
  },
  { requireId: true },
);
assert.equal(flowerMinimal.ok, true);
if (flowerMinimal.ok) {
  assert.equal(flowerMinimal.plant.inventoryType, "flowers");
  assert.equal(flowerMinimal.plant.subtitle, undefined);
  assert.equal(flowerMinimal.plant.images, undefined);
  assert.equal(flowerMinimal.plant.petFriendly, undefined);
  assert.equal(flowerMinimal.plant.description, undefined);
}

const flowerEmptySubtitle = parsePlantBody(
  {
    id: "verify-flower-empty",
    name: "Flower",
    supplierPrice: 20,
    currency: "ILS",
    inventoryType: "flowers",
    subtitle: "",
  },
  { requireId: true },
);
assert.equal(flowerEmptySubtitle.ok, false);

const flowerEmptyImages = parsePlantBody(
  {
    id: "verify-flower-empty-images",
    name: "Flower",
    supplierPrice: 20,
    currency: "ILS",
    inventoryType: "flowers",
    images: [],
  },
  { requireId: true },
);
assert.equal(flowerEmptyImages.ok, false);

const flowerNullOk = parsePlantBody(
  {
    id: "verify-flower-nulls",
    name: "Flower",
    supplierPrice: 20,
    currency: "ILS",
    inventoryType: "flowers",
    subtitle: null,
    description: null,
    images: null,
    labels: null,
    petFriendly: null,
  },
  { requireId: true },
);
assert.equal(flowerNullOk.ok, true);

assert.equal(posRequiresPaymentHold("plants"), true);
assert.equal(posRequiresPaymentHold("flowers"), false);
assert.equal(posStatusAfterSuccessfulPayment("plants"), "sold");
assert.equal(posStatusAfterSuccessfulPayment("flowers"), null);
assert.equal(cardcomLineItemName("flowers", "internal sku"), CARDCOM_FLOWER_LINE_ITEM_NAME);
assert.equal(cardcomLineItemName("plants", "Monstera"), "Monstera");

assert.equal(isCheckoutDeliveryDisabled("flowers"), true);
assert.equal(isCheckoutDeliveryDisabled("plants"), false);
assert.equal(hideCheckoutPickupOption("flowers", true), false);
assert.equal(hideCheckoutPickupOption("plants", true), true);
assert.equal(
  defaultCheckoutFulfillment({ inventoryType: "flowers", pickupDisabled: false }),
  "pickup",
);
assert.equal(
  defaultCheckoutFulfillment({ inventoryType: "plants", pickupDisabled: false }),
  "delivery",
);
assert.equal(
  defaultCheckoutFulfillment({ inventoryType: "flowers", pickupDisabled: true }),
  "pickup",
);

assert.equal(
  posAllowsVerifiedPaymentFinalize("flowers", { status: "available" }, "attempt-1"),
  true,
);
assert.equal(
  posAllowsVerifiedPaymentFinalize(
    "plants",
    { status: "held_for_payment", paymentHoldAttemptId: "attempt-1" },
    "attempt-1",
  ),
  true,
);

const posPage = read("app/pos/[spotSlug]/page.tsx");
assert.match(posPage, /redirect\(posSpotCheckoutPath/);
assert.doesNotMatch(posPage, /PlantHero/);
assert.doesNotMatch(posPage, /FixedBottomCTA/);
assert.doesNotMatch(posPage, /PosPlantLanding/);

const plantLanding = read("components/plant/PosPlantLanding.tsx");
assert.match(plantLanding, /export async function PosPlantLanding/);
assert.match(plantLanding, /PlantHero/);
assert.match(plantLanding, /PlantImageGallery/);
assert.match(plantLanding, /PlantProductAbout/);
assert.match(plantLanding, /PlantProductInfoGrid/);
assert.match(plantLanding, /FixedBottomCTA/);
assert.match(plantLanding, /PlantInventoryBadge/);
assert.match(plantLanding, /PlantPageContactLink/);

const posLoading = read("app/pos/[spotSlug]/loading.tsx");
assert.match(posLoading, /data-page="plant-page"/);

const plantsManager = read("components/admin/AdminPlantsManager.tsx");
assert.match(plantsManager, /if \(inventoryType === "flowers"\) \{/);
assert.match(plantsManager, /inventoryType: "flowers"/);
assert.match(plantsManager, /name: draft\.name\.trim\(\)/);
assert.doesNotMatch(
  plantsManager.slice(
    plantsManager.indexOf('if (inventoryType === "flowers")'),
    plantsManager.indexOf("const baseSupplierPrice"),
  ),
  /subtitle:/,
);

const checkoutPage = read("app/checkout/pos/[spotSlug]/page.tsx");
assert.match(checkoutPage, /TrackPosScan/);
assert.match(checkoutPage, /TrackCheckoutStarted/);
assert.match(checkoutPage, /data-inventory-type/);
assert.match(checkoutPage, /PlantImageGallery/);
assert.doesNotMatch(checkoutPage, /posSpotPath\(/);
assert.doesNotMatch(checkoutPage, /checkout\.back/);

const checkoutForm = read("components/checkout/CheckoutForm.tsx");
assert.match(checkoutForm, /disabled=\{deliveryDisabled/);
assert.match(checkoutForm, /aria-disabled=\{deliveryDisabled/);
assert.match(checkoutForm, /checkout\.submitWithPrice/);
assert.match(checkoutForm, /checkout\.confirm\.flowersPickup/);

const offersHub = read("app/admin/offers/page.tsx");
assert.match(offersHub, /offersPlants/);
assert.match(offersHub, /offersFlowers/);
const offersPlants = read("app/admin/offers/plants/page.tsx");
assert.match(offersPlants, /inventoryType="plants"/);
const offersFlowers = read("app/admin/offers/flowers/page.tsx");
assert.match(offersFlowers, /inventoryType="flowers"/);
const offersManager = read("components/admin/AdminOffersManager.tsx");
assert.match(offersManager, /function AdminOffersManager\(\{ inventoryType \}/);
assert.match(offersManager, /inventoryType=\$\{inventoryType\}/);

const prep = read("lib/startCardcomPaymentPrep.ts");
assert.match(prep, /Flower orders must be picked up/);
assert.match(prep, /posRequiresPaymentHold/);
assert.match(prep, /cardcomLineItemName/);

const attemptStorage = read("lib/paymentAttemptStorage.ts");
assert.match(attemptStorage, /inventory_type <> 'flowers'/);
assert.doesNotMatch(attemptStorage, /posStatusAfterSuccessfulPaymentSql/);

const webhook = read("lib/processCardcomWebhook.ts");
assert.match(webhook, /attemptPosAllowsFinalize/);
assert.match(webhook, /legacyOrderPosAllowsFinalize/);

const expiry = read("lib/paymentHoldExpiry.ts");
assert.match(expiry, /expireStaleFlowerPaymentAttempts/);
assert.match(expiry, /COALESCE\(pl.inventory_type, 'plants'\) = 'flowers'/);
assert.doesNotMatch(expiry, /expireStaleFlowerPaymentAttempts\(id\);\s*return \{ expired: true/);

console.log("OK: flowers phase 1 offline checks");

async function assertNullableFlowerStorage(): Promise<void> {
  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  try {
    await loadEnvLocal();
  } catch {
    console.log("verify-flowers-phase1: skip nullable flower DB (no DATABASE_URL)");
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.log("verify-flowers-phase1: skip nullable flower DB (no DATABASE_URL)");
    return;
  }

  const { randomUUID } = await import("node:crypto");
  const { createPlant, deletePlant, updatePlant } = await import("../lib/plantStorage");
  const { sql } = await import("../lib/db");

  const flowerId = randomUUID();
  try {
    const created = await createPlant({
      id: flowerId,
      name: "באנץ פרחים ירוקים",
      supplierPrice: 20,
      price: 20,
      currency: "ILS",
      inventoryType: "flowers",
    });
    assert.equal(created.inventoryType, "flowers");
    assert.equal(created.subtitle, undefined);
    assert.equal(created.images, undefined);
    assert.equal(created.description, undefined);

    const rows = (await sql`
      SELECT subtitle, description, images, labels, light, water, difficulty,
             location, pet_friendly, care_instructions
      FROM plants
      WHERE id = ${flowerId}
    `) as Record<string, unknown>[];
    const row = rows[0];
    assert.ok(row);
    for (const key of [
      "subtitle",
      "description",
      "images",
      "labels",
      "light",
      "water",
      "difficulty",
      "location",
      "pet_friendly",
      "care_instructions",
    ]) {
      assert.equal(row[key], null, `${key} must be SQL NULL`);
    }

    const updated = await updatePlant(flowerId, {
      ...created,
      name: "באנץ פרחי שושן צחור",
    });
    assert.ok(updated);
    assert.equal(updated!.name, "באנץ פרחי שושן צחור");
    const after = (await sql`
      SELECT subtitle, images, pet_friendly FROM plants WHERE id = ${flowerId}
    `) as { subtitle: unknown; images: unknown; pet_friendly: unknown }[];
    assert.equal(after[0]?.subtitle, null);
    assert.equal(after[0]?.images, null);
    assert.equal(after[0]?.pet_friendly, null);

    try {
      await sql`
        INSERT INTO plants (
          id, name, supplier_price, currency, inventory_type
        ) VALUES (
          ${randomUUID()},
          'Missing Plant Content',
          10,
          'ILS',
          'plants'
        )
      `;
      assert.fail("plants must reject missing catalog fields");
    } catch (error) {
      assert.ok(error);
    }
  } finally {
    await deletePlant(flowerId);
  }
  console.log("verify-flowers-phase1: nullable flower DB ok");
}

void assertNullableFlowerStorage().catch((error) => {
  console.error("verify-flowers-phase1: nullable flower DB FAILED", error);
  process.exitCode = 1;
});

