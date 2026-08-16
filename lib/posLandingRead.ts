/**
 * Combined catalog read for `/pos/[spotSlug]` and `/checkout/pos/[spotSlug]`
 * after hold expiry has already run.
 * Does not touch payment holds, TTL, or purchase eligibility.
 */
import { sql } from "@/lib/db";
import { getOfferById, mapOfferRow, type OfferRow } from "@/lib/offerStorage";
import { getLocationById } from "@/lib/mockLocations";
import { getPartnerLocationById, mapPartnerLocationRow, type PartnerLocationRow } from "@/lib/partnerLocationStorage";
import { getPlantById } from "@/lib/plantCatalog";
import { mapPlantRow, type PlantRow } from "@/lib/plantStorage";
import { getPocketById, mapPocketRow, type PocketRow } from "@/lib/pocketStorage";
import type { PosSpot } from "@/lib/posSpotTypes";
import type { Offer } from "@/lib/offerTypes";
import type { PartnerLocation } from "@/lib/partnerLocationStorage";
import type { PlantProduct } from "@/lib/types";
import type { Pocket } from "@/lib/pocketTypes";

export type PosLandingDetails = {
  offer: Offer | undefined;
  plant: PlantProduct | undefined;
  partner: PartnerLocation | undefined;
  pocket: Pocket | undefined;
};

type LandingJoinRow = {
  offer: OfferRow | null;
  plant: PlantRow | null;
  partner: PartnerLocationRow | null;
  pocket: PocketRow | null;
};

async function loadPosLandingDetailsFallback(posSpot: PosSpot): Promise<PosLandingDetails> {
  const offer = await getOfferById(posSpot.currentOfferId);
  const plant = offer ? await getPlantById(offer.productId) : undefined;
  const partner = await getLocationById(posSpot.partnerLocationId);
  const pocket = posSpot.pocketId ? await getPocketById(posSpot.pocketId) : undefined;
  return { offer, plant, partner, pocket };
}

/**
 * One JOIN for offer + plant + partner + pocket using IDs from the already-resolved POS row.
 * Does not re-read `pos_spots` (keeps the post-expiry snapshot used for CTA/gates).
 */
export async function getPosLandingDetails(posSpot: PosSpot): Promise<PosLandingDetails> {
  const offerId = posSpot.currentOfferId.trim();
  const partnerId = posSpot.partnerLocationId.trim();
  const pocketId = posSpot.pocketId?.trim() || null;
  if (!offerId) {
    return loadPosLandingDetailsFallback(posSpot);
  }

  const rows = (await sql`
    SELECT
      row_to_json(o.*) AS offer,
      row_to_json(pl.*) AS plant,
      row_to_json(loc.*) AS partner,
      row_to_json(pk.*) AS pocket
    FROM offers o
    LEFT JOIN plants pl ON pl.id = o.product_id
    LEFT JOIN partner_locations loc ON loc.id = ${partnerId}
    LEFT JOIN pockets pk ON pk.id = ${pocketId}::uuid
    WHERE o.id = ${offerId}
    LIMIT 1
  `) as LandingJoinRow[];

  const row = rows[0];
  if (!row?.offer) {
    return loadPosLandingDetailsFallback(posSpot);
  }

  const offer = mapOfferRow(row.offer);
  const plant = row.plant ? mapPlantRow(row.plant) : await getPlantById(offer.productId);
  const partner = row.partner
    ? mapPartnerLocationRow(row.partner)
    : partnerId
      ? await getPartnerLocationById(partnerId)
      : undefined;
  const pocket = row.pocket
    ? mapPocketRow(row.pocket)
    : pocketId
      ? await getPocketById(pocketId)
      : undefined;

  return { offer, plant, partner, pocket };
}
