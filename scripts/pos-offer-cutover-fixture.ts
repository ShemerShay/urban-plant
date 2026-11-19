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
  potBId: string;
  sellableS: string;
  sellableSPot: string;
  sellableSPotB: string;
  sellableL: string;
  offerPotB: string;
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
  const { createPot, deletePot, updatePot } = await import("../lib/potStorage");
  const { setPotCentralQuantity } = await import("../lib/potInventoryStorage");
  const { createSellableVariant } = await import("../lib/sellableVariantStorage");
  const { createOrReusePlantOffer } = await import("../lib/offerStorage");

  const plant = await createPlant(parsed.plant);
  const sizeS = await createPlantVariant({ plantId: plant.id, sizeLabel: "S" });
  const sizeL = await createPlantVariant({ plantId: plant.id, sizeLabel: "L" });
  const potA = await updatePot({
    potId: (await createPot({ name: `${tag} pot a` })).id,
    supplierPrice: 12,
  });
  const potB = await updatePot({
    potId: (await createPot({ name: `${tag} pot b` })).id,
    supplierPrice: 8,
  });
  const sellableS = await createSellableVariant({
    plantId: plant.id,
    plantSizeId: sizeS.id,
    potId: null,
  });
  const sellableSPot = await createSellableVariant({
    plantId: plant.id,
    plantSizeId: sizeS.id,
    potId: potA.id,
  });
  const sellableSPotB = await createSellableVariant({
    plantId: plant.id,
    plantSizeId: sizeS.id,
    potId: potB.id,
  });
  const sellableL = await createSellableVariant({
    plantId: plant.id,
    plantSizeId: sizeL.id,
    potId: null,
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
  const offerPotB = await createOrReusePlantOffer({
    sellableVariantId: sellableSPotB.sellableVariantId,
    consumerPrice: 90,
    status: "active",
    availabilities: [{ scope: "partner_location", partnerLocationId }],
  });

  await setPotCentralQuantity({ potId: potA.id, quantity: 5 });
  await setPotCentralQuantity({ potId: potB.id, quantity: 5 });

  const offerLegacy = `occ-legacy-${tag}`;
  const offerFlower = `occ-flower-${tag}`;
  await sql`
    INSERT INTO offers (id, product_id, consumer_price, status, created_at)
    VALUES
      (${offerLegacy}, ${plant.id}, 33, 'active', now()),
      (${offerFlower}, ${flowerPlantId}, 25, 'active', now())
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
    offerPotB: offerPotB.offer.id,
    offerLegacy,
    offerFlower,
    potId: potA.id,
    potBId: potB.id,
    sellableS: sellableS.sellableVariantId,
    sellableSPot: sellableSPot.sellableVariantId,
    sellableSPotB: sellableSPotB.sellableVariantId,
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
        fixture.offerPotB,
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
          ${fixture.sellableSPotB}::uuid,
          ${fixture.sellableL}::uuid
        )
      `;
      await deletePot(fixture.potId);
      await deletePot(fixture.potBId);
      await sql`DELETE FROM inventory_history WHERE variant_id IN (${fixture.variantS}::uuid, ${fixture.variantL}::uuid)`;
      await sql`DELETE FROM inventory WHERE variant_id IN (${fixture.variantS}::uuid, ${fixture.variantL}::uuid)`;
      await sql`DELETE FROM plant_variants WHERE id IN (${fixture.variantS}::uuid, ${fixture.variantL}::uuid)`;
      await deletePlant(fixture.plantId);
    },
  };
}
