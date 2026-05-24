import { NextRequest, NextResponse } from "next/server";

import { readPartnerLocations } from "@/lib/mockLocations";
import { getPlantById } from "@/lib/plantCatalog";
import { readOffers } from "@/lib/offerStorage";
import { updatePartnerLocationAddress } from "@/lib/partnerLocationStorage";
import { formatPosSpotDisplayName, isPosSpotPocketValue } from "@/lib/posSpotPocket";
import { getPosSpotById, PosSpotSlugConflictError, updatePosSpot } from "@/lib/posSpotStorage";
import { buildPosSpotNameAndSlug } from "@/lib/posSpotSlugUtils";

interface RouteParams {
  params: Promise<{ posSpotId: string }>;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function mapOffersForResponse() {
  return readOffers().then((offers) =>
    offers.map((offer) => {
      const product = getPlantById(offer.productId);
      return {
        ...offer,
        productName: product?.name ?? offer.productId,
        currency: product?.currency ?? "ILS",
      };
    }),
  );
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { posSpotId: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const posSpot = await getPosSpotById(id);
  if (!posSpot) {
    return NextResponse.json({ error: "POS Spot not found" }, { status: 404 });
  }
  const [offers, locations] = await Promise.all([mapOffersForResponse(), readPartnerLocations()]);
  return NextResponse.json({ posSpot, offers, locations });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { posSpotId: rawId } = await params;
  const id = decodeURIComponent(rawId);

  const existing = await getPosSpotById(id);
  if (!existing) {
    return NextResponse.json({ error: "POS Spot not found" }, { status: 404 });
  }

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
  const partnerLocationAddress = cleanString(record.partnerLocationAddress);
  const spotDescription = cleanString(record.spotDescription);
  const posNumber = cleanString(record.posNumber);
  const currentOfferId = cleanString(record.currentOfferId);
  const pocketRaw = cleanString(record.pocket);
  const pocketOther = cleanString(record.pocketOther);

  if (!partnerLocationId) {
    return NextResponse.json({ error: "partnerLocationId is required" }, { status: 400 });
  }
  if (!partnerLocationAddress) {
    return NextResponse.json({ error: "partnerLocationAddress is required" }, { status: 400 });
  }
  if (!posNumber) {
    return NextResponse.json({ error: "posNumber is required" }, { status: 400 });
  }
  if (!currentOfferId) {
    return NextResponse.json({ error: "currentOfferId is required" }, { status: 400 });
  }

  const locations = await readPartnerLocations();
  const partnerLocation = locations.find((loc) => loc.id === partnerLocationId);
  if (!partnerLocation) {
    return NextResponse.json({ error: "Partner Location not found" }, { status: 404 });
  }

  const offers = await readOffers();
  const offer = offers.find((item) => item.id === currentOfferId);
  if (!offer) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  }
  if (offer.status !== "active" && currentOfferId !== existing.currentOfferId) {
    return NextResponse.json(
      { error: "When changing the offer, choose an active offer." },
      { status: 400 },
    );
  }

  const updatedLocation = await updatePartnerLocationAddress(partnerLocationId, partnerLocationAddress);
  if (!updatedLocation) {
    return NextResponse.json({ error: "Could not update partner address" }, { status: 400 });
  }

  let pocket: string | null = pocketRaw || existing.pocket || null;
  if (pocket && !isPosSpotPocketValue(pocket)) {
    return NextResponse.json({ error: "Invalid pocket value" }, { status: 400 });
  }
  if (pocket === "other" && !pocketOther) {
    return NextResponse.json({ error: "pocketOther is required when pocket is other" }, { status: 400 });
  }

  let spotName = existing.spotName;
  let spotSlug = existing.spotSlug;
  let posName = existing.posName;
  let pocketForUpdate: string | null = pocket;

  if (pocket) {
    const generated = buildPosSpotNameAndSlug(
      partnerLocation.name,
      posNumber,
      pocket,
      pocketOther,
    );
    spotName = generated.spotName;
    spotSlug = generated.spotSlug;
    posName = formatPosSpotDisplayName(partnerLocation.name, posNumber, pocket, pocketOther);
  } else {
    pocketForUpdate = null;
  }

  const hasCheckStatus = typeof record.checkStatus === "boolean";
  const posWeeklyNoteRaw = record.posWeeklyNote;
  const hasPosWeeklyNote = "posWeeklyNote" in record;
  const offerPlacedAtRaw = record.offerPlacedAt;
  const hasOfferPlacedAt = "offerPlacedAt" in record;

  let offerPlacedAt: string | null | undefined;
  if (hasOfferPlacedAt) {
    if (offerPlacedAtRaw === null || offerPlacedAtRaw === "") {
      offerPlacedAt = null;
    } else if (typeof offerPlacedAtRaw === "string" && offerPlacedAtRaw.trim()) {
      const t = Date.parse(offerPlacedAtRaw.trim());
      if (Number.isNaN(t)) {
        return NextResponse.json({ error: "offerPlacedAt must be a valid ISO datetime" }, { status: 400 });
      }
      offerPlacedAt = new Date(t).toISOString();
    } else {
      return NextResponse.json({ error: "offerPlacedAt must be a string or null" }, { status: 400 });
    }
  }

  try {
    const posSpot = await updatePosSpot(id, {
      partnerLocationId,
      posNumber,
      posName,
      spotName,
      ...(spotDescription ? { spotDescription } : {}),
      spotSlug,
      pocket: pocketForUpdate,
      pocketOther: pocketForUpdate === "other" ? pocketOther || null : null,
      currentOfferId,
      ...(hasCheckStatus
        ? {
            updateCheckFields: true as const,
            checkStatus: record.checkStatus as boolean,
            checkBy:
              typeof record.checkBy === "string"
                ? record.checkBy.trim() || null
                : record.checkBy === null
                  ? null
                  : null,
          }
        : {}),
      ...(hasPosWeeklyNote
        ? {
            updatePosWeeklyNote: true as const,
            posWeeklyNote:
              typeof posWeeklyNoteRaw === "string"
                ? posWeeklyNoteRaw.trim() || null
                : posWeeklyNoteRaw === null
                  ? null
                  : null,
          }
        : {}),
      ...(hasOfferPlacedAt
        ? { updateOfferPlacedAt: true as const, offerPlacedAt: offerPlacedAt ?? null }
        : {}),
    });
    if (!posSpot) {
      return NextResponse.json({ error: "Could not update POS Spot" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, posSpot });
  } catch (err) {
    if (err instanceof PosSpotSlugConflictError) {
      return NextResponse.json({ error: "Spot slug is already used by another POS Spot" }, { status: 409 });
    }
    throw err;
  }
}
