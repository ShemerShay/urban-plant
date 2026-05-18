import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { appendEvent } from "@/lib/eventStorage";
import { locations } from "@/lib/mockLocations";
import { getPlantById } from "@/lib/mockPlants";
import { readOffers } from "@/lib/offerStorage";
import { appendPosSpot, posSpotSlugPart, readPosSpots } from "@/lib/posSpotStorage";
import type { PosSpotStatus } from "@/lib/posSpotTypes";

function normalizeStatus(value: unknown): PosSpotStatus {
  if (value === "sold" || value === "inactive") return value;
  return "available";
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
  const [offers, posSpots] = await Promise.all([readOffers(), readPosSpots()]);
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
  const rawSpotSlug = cleanString(record.spotSlug);
  const spotSlug = posSpotSlugPart(rawSpotSlug);
  const posNumber = cleanString(record.posNumber);
  const placementNotes = cleanString(record.placementNotes);
  const placedAt = new Date().toISOString();
  const status = normalizeStatus(record.status);

  if (!partnerLocationId) {
    return NextResponse.json({ error: "partnerLocationId is required" }, { status: 400 });
  }
  if (!locations.some((loc) => loc.id === partnerLocationId)) {
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
  if (!spotDescription) {
    return NextResponse.json({ error: "spotDescription is required" }, { status: 400 });
  }
  if (!spotSlug) {
    return NextResponse.json({ error: "spotSlug is required" }, { status: 400 });
  }

  const createdAt = new Date().toISOString();
  const posSpot = {
    id: `pos-${spotSlug}`,
    partnerLocationId,
    ...(posNumber ? { posNumber } : {}),
    spotDescription,
    ...(placementNotes ? { placementNotes } : {}),
    spotSlug,
    currentOfferId,
    status,
    placedAt,
    createdAt,
  };

  try {
    await appendPosSpot(posSpot);
  } catch {
    return NextResponse.json({ error: "POS Spot id or spot slug already exists" }, { status: 409 });
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
      spotDescription,
      status,
    },
  });

  return NextResponse.json({ ok: true, posSpot });
}
