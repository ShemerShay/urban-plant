import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { appendEvent } from "@/lib/eventStorage";
import { readPartnerLocations } from "@/lib/mockLocations";
import { getPlantById } from "@/lib/plantCatalog";
import { readOffers } from "@/lib/offerStorage";
import { formatPosSpotDisplayName, isPosSpotPocketValue } from "@/lib/posSpotPocket";
import { appendPosSpot, readPosSpots } from "@/lib/posSpotStorage";
import { buildPosSpotNameAndSlug } from "@/lib/posSpotSlugUtils";
import type { PosSpotStatus } from "@/lib/posSpotTypes";

function normalizeStatus(value: unknown): PosSpotStatus {
  if (value === "sold" || value === "inactive") return value;
  return "available";
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
  const [offers, posSpots, locations] = await Promise.all([
    readOffers(),
    readPosSpots(),
    readPartnerLocations(),
  ]);
  return NextResponse.json({
    offers: offers.map((offer) => {
      const product = getPlantById(offer.productId);
      return {
        ...offer,
        productName: product?.name ?? offer.productId,
        currency: product?.currency ?? "ILS",
      };
    }),
    locations,
    posSpots,
  });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const partnerLocationId = cleanString(record.partnerLocationId);
  const currentOfferId = cleanString(record.currentOfferId);
  const spotDescription = cleanString(record.spotDescription);
  const posNumber = cleanString(record.posNumber);
  const placementNotes = cleanString(record.placementNotes);
  const pocket = cleanString(record.pocket);
  const pocketOther = cleanString(record.pocketOther);
  const offerPlacedAt = new Date().toISOString();
  const status = normalizeStatus(record.status);

  if (!partnerLocationId) {
    return NextResponse.json({ error: "partnerLocationId is required" }, { status: 400 });
  }
  const locations = await readPartnerLocations();
  const partnerLocation = locations.find((loc) => loc.id === partnerLocationId);
  if (!partnerLocation) {
    return NextResponse.json({ error: "Partner Location not found" }, { status: 404 });
  }
  if (!currentOfferId) {
    return NextResponse.json({ error: "currentOfferId is required" }, { status: 400 });
  }
  const offers = await readOffers();
  const offer = offers.find((item) => item.id === currentOfferId);
  if (!offer || offer.status !== "active") {
    return NextResponse.json({ error: "Active Offer not found" }, { status: 404 });
  }
  if (!posNumber) {
    return NextResponse.json({ error: "posNumber is required" }, { status: 400 });
  }
  if (!pocket || !isPosSpotPocketValue(pocket)) {
    return NextResponse.json({ error: "pocket is required" }, { status: 400 });
  }
  if (pocket === "other" && !pocketOther) {
    return NextResponse.json({ error: "pocketOther is required when pocket is other" }, { status: 400 });
  }

  const { spotName, spotSlug } = buildPosSpotNameAndSlug(
    partnerLocation.name,
    posNumber,
    pocket,
    pocketOther,
  );
  if (!spotName || !spotSlug) {
    return NextResponse.json({ error: "Could not generate spot name from inputs" }, { status: 400 });
  }

  const posName = formatPosSpotDisplayName(partnerLocation.name, posNumber, pocket, pocketOther);
  const createdAt = new Date().toISOString();
  const posSpot = {
    id: randomUUID(),
    spotName,
    partnerLocationId,
    posNumber,
    pocket,
    ...(pocket === "other" && pocketOther ? { pocketOther } : {}),
    posName,
    ...(spotDescription ? { spotDescription } : {}),
    ...(placementNotes ? { placementNotes } : {}),
    spotSlug,
    currentOfferId,
    status,
    checkStatus: false as const,
    offerPlacedAt,
    createdAt,
  };

  try {
    await appendPosSpot(posSpot);
  } catch {
    return NextResponse.json({ error: "POS Spot spot name or spot slug already exists" }, { status: 409 });
  }

  await appendEvent({
    id: randomUUID(),
    type: "plant_placed",
    posSpotId: posSpot.id,
    offerId: currentOfferId,
    productId: offer.productId,
    partnerLocationId,
    createdAt,
    createdBy: "admin",
    data: {
      spotSlug,
      spotName,
      posName,
      pocket,
      ...(spotDescription ? { spotDescription } : {}),
      status,
    },
  });

  return NextResponse.json({ ok: true, posSpot });
}
