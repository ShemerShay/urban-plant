/**
 * Shared Admin POS-spots list payload (scoped or global).
 * Batches plant metadata; scopes hold-expiry to the returned spot set.
 */
import "server-only";

import { sql } from "@/lib/db";
import type { InventoryType } from "@/lib/inventoryType";
import { readOffers } from "@/lib/offerStorage";
import {
  isPlantPosEligibleOffer,
  isPosAssignableOffer,
  type Offer,
} from "@/lib/offerTypes";
import { resolveSpotOffers, type PartnerPlantProduct } from "@/lib/partnerPlantSummary";
import { readPartnerLocations, type PartnerLocation } from "@/lib/partnerLocationStorage";
import { expireStalePaymentHold } from "@/lib/paymentHoldExpiry";
import {
  readPosSpots,
  readPosSpotsByPartner,
} from "@/lib/posSpotStorage";
import type { PosSpot } from "@/lib/posSpotTypes";

export type AdminPosSpotOffer = Offer & {
  productName: string;
  currency: "ILS" | "USD" | "EUR";
  inventoryType: InventoryType | null;
};

export type AdminPosSpotsPayload = {
  offers: AdminPosSpotOffer[];
  spotOffers: ReturnType<typeof resolveSpotOffers>;
  posSpots: PosSpot[];
  /** Present only on unscoped list responses (legacy consumers). */
  locations?: PartnerLocation[];
  /** Present only on unscoped list responses (legacy empty array). */
  potColors?: [];
};

type PlantPosMeta = {
  name: string;
  currency: "ILS" | "USD" | "EUR";
  inventoryType: InventoryType;
};

async function loadPlantPosMetaByIds(
  productIds: readonly string[],
): Promise<Map<string, PlantPosMeta>> {
  const ids = [...new Set(productIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await sql`
    SELECT id, name, currency, inventory_type
    FROM plants
    WHERE id = ANY(${ids}::text[])
  `;
  const byId = new Map<string, PlantPosMeta>();
  for (const row of rows as {
    id: string;
    name: string;
    currency: string | null;
    inventory_type: string | null;
  }[]) {
    const currency =
      row.currency === "USD" || row.currency === "EUR" || row.currency === "ILS"
        ? row.currency
        : "ILS";
    const inventoryType: InventoryType =
      row.inventory_type === "flowers" ? "flowers" : "plants";
    byId.set(row.id, {
      name: row.name.trim() || row.id,
      currency,
      inventoryType,
    });
  }
  return byId;
}

async function expireHeldInSet(spots: PosSpot[]): Promise<boolean> {
  const held = spots.filter((spot) => spot.status === "held_for_payment");
  if (held.length === 0) return false;
  await Promise.all(held.map((spot) => expireStalePaymentHold(spot.id)));
  return true;
}

function buildPayload(
  posSpots: PosSpot[],
  offers: Offer[],
  productById: Map<string, PlantPosMeta>,
  partnerLocationId: string | null,
): Pick<AdminPosSpotsPayload, "offers" | "spotOffers" | "posSpots"> {
  const referencedOfferIds = new Set(
    posSpots
      .map((spot) => spot.currentOfferId)
      .filter((id): id is string => Boolean(id)),
  );

  const posOffers = offers.filter((offer) => {
    if (referencedOfferIds.has(offer.id)) return true;
    if (!isPosAssignableOffer(offer)) return false;
    const inventoryType = productById.get(offer.productId)?.inventoryType ?? "plants";
    if (inventoryType === "flowers") return true;
    return partnerLocationId
      ? isPlantPosEligibleOffer(offer, partnerLocationId)
      : Boolean(offer.sellableVariantId);
  });

  const enrichedOffers: AdminPosSpotOffer[] = posOffers.map((offer) => {
    const product = productById.get(offer.productId);
    return {
      ...offer,
      productName: product?.name ?? offer.productId,
      currency: product?.currency ?? "ILS",
      inventoryType: product?.inventoryType ?? null,
    };
  });

  const catalogById = new Map<string, PartnerPlantProduct>();
  for (const [id, product] of productById) {
    catalogById.set(id, { name: product.name, inventoryType: product.inventoryType });
  }

  return {
    offers: enrichedOffers,
    spotOffers: resolveSpotOffers(posSpots, offers, catalogById),
    posSpots,
  };
}

async function enrichFromOffersAndSpots(
  posSpots: PosSpot[],
  partnerLocationId: string | null,
): Promise<Pick<AdminPosSpotsPayload, "offers" | "spotOffers" | "posSpots">> {
  const offers = await readOffers();
  const referencedOfferIds = new Set(
    posSpots
      .map((spot) => spot.currentOfferId)
      .filter((id): id is string => Boolean(id)),
  );
  const productIds = [
    ...new Set(
      offers
        .filter((offer) => isPosAssignableOffer(offer) || referencedOfferIds.has(offer.id))
        .map((offer) => offer.productId),
    ),
  ];
  const productById = await loadPlantPosMetaByIds(productIds);
  return buildPayload(posSpots, offers, productById, partnerLocationId);
}

/** Admin location detail / scoped list — request-time hold repair on this set only. */
export async function loadAdminPosSpotsForLocation(
  partnerLocationId: string,
): Promise<Pick<AdminPosSpotsPayload, "offers" | "spotOffers" | "posSpots">> {
  const locationId = partnerLocationId.trim();
  if (!locationId) {
    return { offers: [], spotOffers: [], posSpots: [] };
  }

  let posSpots = await readPosSpotsByPartner(locationId);
  if (await expireHeldInSet(posSpots)) {
    posSpots = await readPosSpotsByPartner(locationId);
  }

  return enrichFromOffersAndSpots(posSpots, locationId);
}

/** Unscoped Admin list (routes smoke / legacy). Batched plants; global held repair. */
export async function loadAdminPosSpotsAll(): Promise<AdminPosSpotsPayload> {
  const [offersInitial, spotsInitial, locations] = await Promise.all([
    readOffers(),
    readPosSpots(),
    readPartnerLocations(),
  ]);

  let posSpots = spotsInitial;
  if (await expireHeldInSet(posSpots)) {
    posSpots = await readPosSpots();
  }

  // Reuse offers from the first read when no hold expiry ran; otherwise spots may have
  // changed but offers are unchanged — still fine to reuse offersInitial.
  const referencedOfferIds = new Set(
    posSpots
      .map((spot) => spot.currentOfferId)
      .filter((id): id is string => Boolean(id)),
  );
  const productIds = [
    ...new Set(
      offersInitial
        .filter((offer) => isPosAssignableOffer(offer) || referencedOfferIds.has(offer.id))
        .map((offer) => offer.productId),
    ),
  ];
  const productById = await loadPlantPosMetaByIds(productIds);
  const core = buildPayload(posSpots, offersInitial, productById, null);

  return {
    ...core,
    locations,
    potColors: [],
  };
}
