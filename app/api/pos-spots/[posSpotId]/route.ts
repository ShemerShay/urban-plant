import { NextRequest, NextResponse } from "next/server";

import { readPartnerLocations } from "@/lib/mockLocations";
import { getPlantById } from "@/lib/plantCatalog";
import { readOffers } from "@/lib/offerStorage";
import { MANUAL_OFFER_ID, MANUAL_PRODUCT_ID } from "@/lib/offerTypes";
import { getPocketById } from "@/lib/pocketStorage";
import { updatePartnerLocationAddress } from "@/lib/partnerLocationStorage";
import {
  getPosSpotById,
  PosSpotPaymentHoldLockedError,
  PosSpotSlugConflictError,
  updatePosSpot,
} from "@/lib/posSpotStorage";
import { formatPosSpotDisplayName } from "@/lib/posSpotSlugUtils";
import type { PosSpotStatus } from "@/lib/posSpotTypes";

interface RouteParams {
  params: Promise<{ posSpotId: string }>;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parsePosSpotStatus(value: unknown): PosSpotStatus | null {
  if (
    value === "available" ||
    value === "sold" ||
    value === "inactive" ||
    value === "held_for_payment"
  ) {
    return value;
  }
  return null;
}

async function mapOffersForResponse() {
  const offers = (await readOffers()).filter(
    (offer) => offer.id !== MANUAL_OFFER_ID && offer.productId !== MANUAL_PRODUCT_ID,
  );
  return Promise.all(
    offers.map(async (offer) => {
      const product = await getPlantById(offer.productId);
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
  const partnerLocationId = cleanString(record.partnerLocationId) || existing.partnerLocationId;
  const partnerLocationAddress = cleanString(record.partnerLocationAddress);
  const spotDescription = cleanString(record.spotDescription);
  const posNumber = cleanString(record.posNumber) || existing.posNumber || "";
  const currentOfferId = cleanString(record.currentOfferId) || existing.currentOfferId;
  const hasPocketId = "pocketId" in record;
  const pocketIdRaw =
    record.pocketId === null
      ? null
      : typeof record.pocketId === "string"
        ? record.pocketId.trim() || null
        : hasPocketId
          ? null
          : undefined;

  if (!partnerLocationId) {
    return NextResponse.json({ error: "partnerLocationId is required" }, { status: 400 });
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

  if (partnerLocationAddress) {
    const updatedLocation = await updatePartnerLocationAddress(
      partnerLocationId,
      partnerLocationAddress,
    );
    if (!updatedLocation) {
      return NextResponse.json({ error: "Could not update partner address" }, { status: 400 });
    }
  }

  const offers = await readOffers();
  const offer = offers.find((item) => item.id === currentOfferId);
  if (!offer) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  }
  if (
    offer.id === MANUAL_OFFER_ID ||
    offer.productId === MANUAL_PRODUCT_ID ||
    (offer.status !== "active" && currentOfferId !== existing.currentOfferId)
  ) {
    return NextResponse.json(
      {
        error:
          offer.id === MANUAL_OFFER_ID || offer.productId === MANUAL_PRODUCT_ID
            ? "Manual offers cannot be used on POS spots"
            : "When changing the offer, choose an active offer.",
      },
      { status: 400 },
    );
  }

  let nextPocketId = existing.pocketId ?? null;
  let pocketName: string | undefined;
  if (hasPocketId) {
    if (pocketIdRaw) {
      const pocket = await getPocketById(pocketIdRaw);
      if (!pocket || pocket.partnerLocationId !== partnerLocationId) {
        return NextResponse.json(
          { error: "Pocket not found for this partner" },
          { status: 400 },
        );
      }
      nextPocketId = pocket.id;
      pocketName = pocket.name;
    } else {
      nextPocketId = null;
      pocketName = undefined;
    }
  } else if (existing.pocketId) {
    const pocket = await getPocketById(existing.pocketId);
    pocketName = pocket?.name;
  }

  // Slug / spot_name stay stable on update — QR identity must not change when pocket moves.
  const posName = formatPosSpotDisplayName(
    partnerLocation.name,
    posNumber,
    pocketName,
  );

  const statusRaw = record.status;
  const hasStatus = "status" in record;
  const parsedStatus = hasStatus ? parsePosSpotStatus(statusRaw) : null;
  if (hasStatus && !parsedStatus) {
    return NextResponse.json(
      { error: "status must be available, sold, inactive, or held_for_payment" },
      { status: 400 },
    );
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
      ...(spotDescription ? { spotDescription } : {}),
      ...(hasPocketId
        ? { updatePocketId: true as const, pocketId: nextPocketId }
        : {}),
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
      ...(hasStatus && parsedStatus
        ? { updateStatus: true as const, status: parsedStatus }
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
    if (err instanceof PosSpotPaymentHoldLockedError) {
      return NextResponse.json(
        {
          error:
            "This POS spot is held for an active payment attempt and cannot change status until the attempt completes or expires",
        },
        { status: 409 },
      );
    }
    throw err;
  }
}
