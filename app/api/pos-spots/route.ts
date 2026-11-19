import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  loadAdminPosSpotsAll,
  loadAdminPosSpotsForLocation,
} from "@/lib/adminPosSpotsPayload";
import { appendEvent } from "@/lib/eventStorage";
import { readPartnerLocations } from "@/lib/mockLocations";
import { readOffers } from "@/lib/offerStorage";
import { isPosAssignableOffer } from "@/lib/offerTypes";
import { readPartnerLocationsByPartnerId } from "@/lib/partnerLocationStorage";
import { getPocketById } from "@/lib/pocketStorage";
import { posCentralStockHttpError, writePosCreate } from "@/lib/posCentralStock";
import {
  occupancyToSpotFields,
  PosOccupancyError,
  resolveOccupancyForPosCreate,
} from "@/lib/posOccupancy";
import {
  PosSpotSlugConflictError,
  readPosSpotsByPartnerLocationIds,
} from "@/lib/posSpotStorage";
import {
  buildPosSpotNameAndSlug,
  formatPosSpotDisplayName,
} from "@/lib/posSpotSlugUtils";
import type { PosSpotStatus } from "@/lib/posSpotTypes";

function normalizeStatus(value: unknown): PosSpotStatus {
  if (
    value === "sold" ||
    value === "inactive" ||
    value === "held_for_payment" ||
    value === "available"
  ) {
    return value;
  }
  return "available";
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: NextRequest) {
  const partnerId = cleanString(request.nextUrl.searchParams.get("partnerId"));
  const brandId = cleanString(request.nextUrl.searchParams.get("brandId"));

  // Brand Admin list: spots only (no offers / hold repair — counts & search only).
  if (brandId) {
    const brandLocations = await readPartnerLocationsByPartnerId(brandId);
    const posSpots = await readPosSpotsByPartnerLocationIds(
      brandLocations.map((location) => location.id),
    );
    return NextResponse.json({ posSpots });
  }

  // Location Admin detail: scoped spots + request-time hold repair on that set only.
  if (partnerId) {
    const payload = await loadAdminPosSpotsForLocation(partnerId);
    return NextResponse.json({
      offers: payload.offers,
      spotOffers: payload.spotOffers,
      posSpots: payload.posSpots,
    });
  }

  const payload = await loadAdminPosSpotsAll();
  return NextResponse.json(payload);
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
  const pocketIdRaw = cleanString(record.pocketId);
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
  if (!offer || !isPosAssignableOffer(offer)) {
    return NextResponse.json(
      { error: "Active catalog offer required (manual offers cannot be used on POS spots)" },
      { status: 400 },
    );
  }

  let occupancy;
  try {
    occupancy = await resolveOccupancyForPosCreate({
      offerId: currentOfferId,
      partnerLocationId,
    });
  } catch (err) {
    if (err instanceof PosOccupancyError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  const occupancyFields = occupancyToSpotFields(occupancy);
  if (!posNumber) {
    return NextResponse.json({ error: "posNumber is required" }, { status: 400 });
  }

  let pocketName: string | undefined;
  let pocketId: string | undefined;
  if (pocketIdRaw) {
    const pocket = await getPocketById(pocketIdRaw);
    if (!pocket || pocket.partnerLocationId !== partnerLocationId) {
      return NextResponse.json(
        { error: "Pocket not found for this partner" },
        { status: 400 },
      );
    }
    pocketId = pocket.id;
    pocketName = pocket.name;
  }

  const { spotName, spotSlug } = buildPosSpotNameAndSlug(
    partnerLocation.name,
    posNumber,
  );
  if (!spotName || !spotSlug) {
    return NextResponse.json({ error: "Could not generate spot name from inputs" }, { status: 400 });
  }

  const posName = formatPosSpotDisplayName(
    partnerLocation.name,
    posNumber,
    pocketName,
  );
  const createdAt = new Date().toISOString();
  const posSpot = {
    id: randomUUID(),
    spotName,
    partnerLocationId,
    posNumber,
    ...(pocketId ? { pocketId } : {}),
    posName,
    ...(spotDescription ? { spotDescription } : {}),
    ...(placementNotes ? { placementNotes } : {}),
    spotSlug,
    ...(occupancyFields.currentOfferId
      ? { currentOfferId: occupancyFields.currentOfferId }
      : {}),
    ...(occupancyFields.plantVariantId
      ? { plantVariantId: occupancyFields.plantVariantId }
      : {}),
    ...(occupancyFields.potId ? { potId: occupancyFields.potId } : {}),
    status: occupancy.forceAvailable ? "available" : status,
    checkStatus: false as const,
    ...(occupancyFields.offerPlacedAt
      ? { offerPlacedAt: occupancyFields.offerPlacedAt }
      : {}),
    createdAt,
  };

  try {
    await writePosCreate({
      occupancyAction: occupancy.action,
      inventorySource: record.inventorySource,
      posSpot,
      variantId: occupancy.plantVariantId,
      potId: occupancy.potId,
    });
  } catch (err) {
    if (err instanceof PosSpotSlugConflictError) {
      return NextResponse.json(
        { error: "POS Spot spot name or spot slug already exists" },
        { status: 409 },
      );
    }
    const mapped = posCentralStockHttpError(err);
    if (mapped) {
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    if (err instanceof Error && /already exists/i.test(err.message)) {
      return NextResponse.json(
        { error: "POS Spot spot name or spot slug already exists" },
        { status: 409 },
      );
    }
    throw err;
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
      ...(pocketId ? { pocketId } : {}),
      ...(pocketName ? { pocketName } : {}),
      ...(spotDescription ? { spotDescription } : {}),
      status,
    },
  });

  return NextResponse.json({ ok: true, posSpot });
}
