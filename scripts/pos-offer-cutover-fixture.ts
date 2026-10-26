/**
 * Shared catalog rows for Slice 6 POS verifiers.
 * Creates and deletes its own plant / sizes / pot / offers. Does not invent production data.
 */

import { randomUUID } from "node:crypto";

import { parsePlantBody } from "../lib/plantValidation.ts";
import type { sql as SqlClient } from "../lib/db.ts";

export type PosCutoverFixture = {
  plantId: string;
  variantS: string;
  variantL: string;
  offerS: string;
  offerS2: string;
  offerS3: string;
  offerL: string;
  offerL2: string;
  offerPot: string;
  offerPot2: string;
  offerLegacy: string;
  offerFlower: string;
  potId: string;
  potSizeId: string;
  colorA: string;
  colorB: string;
  sellableS: string;
  sellableSPot: string;
  sellableL: string;
};

export async function createPosCutoverFixture(input: {
  sql: typeof SqlClient;
  tag: string;
  partnerLocationId: string;
  secondLocationId?: string;
  flowerPlantId: string;
}): Promise<PosCutoverFixture & { cleanup: () => Promise<void> }> {
  const { sql, tag, partnerLocationId, secondLocationId, flowerPlantId } = input;
  const parsed = parsePlantBody(
    {
      id: randomUUID(),
      name: `${tag} plant`,
      subtitle: "Leaf",
      description: "A plant",
      supplierPrice: 40,
      currency: "ILS",
      images: ["https://example.com/p.jpg"],
      labels: ["indoor"],
      light: "Medium light",
      water: "Weekly",
      location: "Indoor",
      petFriendly: false,
      careInstructions: ["Water"],
      inventoryType: "plants",
    },
    { requireId: true },
  );
  if (!parsed.ok) throw new Error(parsed.error);

  const { createPlant, deletePlant } = await import("../lib/plantStorage");
  const { createPlantVariant } = await import("../lib/plantVariantStorage");
  const { createPot, deletePot } = await import("../lib/potStorage");
  const { createPotSize, createPotColor } = await import("../lib/potSizeStorage");
  const { createSellableVariant } = await import("../lib/sellableVariantStorage");
  const { createOrReusePlantOffer } = await import("../lib/offerStorage");

  const plant = await createPlant(parsed.plant);
  const sizeS = await createPlantVariant({ plantId: plant.id, sizeLabel: "S", catalogPrice: 40 });
  const sizeL = await createPlantVariant({ plantId: plant.id, sizeLabel: "L", catalogPrice: 70 });
  const pot = await createPot({ name: `${tag} pot` });
  const potSize = await createPotSize({ potId: pot.id, sizeLabel: "M", supplierPrice: 12 });
  const colorA = await createPotColor({
    potId: pot.id,
    sizeId: potSize.id,
    color: `${tag}-terra`,
  });
  const colorB = await createPotColor({
    potId: pot.id,
    sizeId: potSize.id,
    color: `${tag}-white`,
  });
  const sellableS = await createSellableVariant({
    plantId: plant.id,
    plantSizeId: sizeS.id,
    potSizeId: null,
  });
  const sellableSPot = await createSellableVariant({
    plantId: plant.id,
    plantSizeId: sizeS.id,
    potSizeId: potSize.id,
  });
  const sellableL = await createSellableVariant({
    plantId: plant.id,
    plantSizeId: sizeL.id,
    potSizeId: null,
  });

  const locationAvailabilities = [
    { scope: "partner_location" as const, partnerLocationId },
    ...(secondLocationId
      ? [{ scope: "partner_location" as const, partnerLocationId: secondLocationId }]
      : []),
  ];

  const offerS = await createOrReusePlantOffer({
    sellableVariantId: sellableS.sellableVariantId,
    consumerPrice: 40,
    status: "active",
    availabilities: locationAvailabilities,
  });
  const offerS2 = await createOrReusePlantOffer({
    sellableVariantId: sellableS.sellableVariantId,
    consumerPrice: 41,
    status: "active",
    availabilities: [{ scope: "partner_location", partnerLocationId }],
  });
  const offerS3 = await createOrReusePlantOffer({
    sellableVariantId: sellableS.sellableVariantId,
    consumerPrice: 42,
    status: "active",
    availabilities: [{ scope: "partner_location", partnerLocationId }],
  });
  const offerL = await createOrReusePlantOffer({
    sellableVariantId: sellableL.sellableVariantId,
    consumerPrice: 55,
    status: "active",
    availabilities: [{ scope: "partner_location", partnerLocationId }],
  });
  const offerL2 = await createOrReusePlantOffer({
    sellableVariantId: sellableL.sellableVariantId,
    consumerPrice: 56,
    status: "active",
    availabilities: [{ scope: "partner_location", partnerLocationId }],
  });
  const offerPot = await createOrReusePlantOffer({
    sellableVariantId: sellableSPot.sellableVariantId,
    consumerPrice: 88,
    status: "active",
    availabilities: [{ scope: "partner_location", partnerLocationId }],
  });
  const offerPot2 = await createOrReusePlantOffer({
    sellableVariantId: sellableSPot.sellableVariantId,
    consumerPrice: 89,
    status: "active",
    availabilities: [{ scope: "partner_location", partnerLocationId }],
  });

  const offerLegacy = `occ-legacy-${tag}`;
  const offerFlower = `occ-flower-${tag}`;
  await sql`
    INSERT INTO offers (id, product_id, variant_id, consumer_price, status, created_at)
    VALUES
      (${offerLegacy}, ${plant.id}, NULL, 33, 'active', now()),
      (${offerFlower}, ${flowerPlantId}, NULL, 25, 'active', now())
  `;

  const fixture: PosCutoverFixture = {
    plantId: plant.id,
    variantS: sizeS.id,
    variantL: sizeL.id,
    offerS: offerS.offer.id,
    offerS2: offerS2.offer.id,
    offerS3: offerS3.offer.id,
    offerL: offerL.offer.id,
    offerL2: offerL2.offer.id,
    offerPot: offerPot.offer.id,
    offerPot2: offerPot2.offer.id,
    offerLegacy,
    offerFlower,
    potId: pot.id,
    potSizeId: potSize.id,
    colorA: colorA.id,
    colorB: colorB.id,
    sellableS: sellableS.sellableVariantId,
    sellableSPot: sellableSPot.sellableVariantId,
    sellableL: sellableL.sellableVariantId,
  };

  return {
    ...fixture,
    cleanup: async () => {
      const offerIds = [
        fixture.offerS,
        fixture.offerS2,
        fixture.offerS3,
        fixture.offerL,
        fixture.offerL2,
        fixture.offerPot,
        fixture.offerPot2,
        fixture.offerLegacy,
        fixture.offerFlower,
      ];
      await sql`DELETE FROM offer_availabilities WHERE offer_id = ANY(${offerIds})`;
      await sql`DELETE FROM offers WHERE id = ANY(${offerIds})`;
      await sql`
        DELETE FROM sellable_variants
        WHERE id IN (
          ${fixture.sellableS}::uuid,
          ${fixture.sellableSPot}::uuid,
          ${fixture.sellableL}::uuid
        )
      `;
      await sql`DELETE FROM pot_inventory_history WHERE pot_color_id IN (${fixture.colorA}::uuid, ${fixture.colorB}::uuid)`;
      await sql`DELETE FROM pot_inventory WHERE pot_color_id IN (${fixture.colorA}::uuid, ${fixture.colorB}::uuid)`;
      await sql`DELETE FROM pot_colors WHERE id IN (${fixture.colorA}::uuid, ${fixture.colorB}::uuid)`;
      await sql`DELETE FROM pot_sizes WHERE id = ${fixture.potSizeId}::uuid`;
      await deletePot(fixture.potId);
      await sql`DELETE FROM inventory_history WHERE variant_id IN (${fixture.variantS}::uuid, ${fixture.variantL}::uuid)`;
      await sql`DELETE FROM inventory WHERE variant_id IN (${fixture.variantS}::uuid, ${fixture.variantL}::uuid)`;
      await sql`DELETE FROM plant_variants WHERE id IN (${fixture.variantS}::uuid, ${fixture.variantL}::uuid)`;
      await deletePlant(fixture.plantId);
    },
  };
}
