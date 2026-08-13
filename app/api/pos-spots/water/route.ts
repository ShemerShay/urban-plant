import { NextRequest, NextResponse } from "next/server";

import { readPartnerLocations } from "@/lib/mockLocations";
import { markPosSpotsWatered } from "@/lib/posSpotStorage";

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * POST /api/pos-spots/water
 * Body: { partnerLocationId: string, posSpotIds: string[] }
 * Sets last_watered_at = now() for eligible spots (available / held_for_payment) in that store.
 */
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
  if (!partnerLocationId) {
    return NextResponse.json({ error: "partnerLocationId is required" }, { status: 400 });
  }

  if (!Array.isArray(record.posSpotIds)) {
    return NextResponse.json({ error: "posSpotIds must be an array" }, { status: 400 });
  }

  const posSpotIds = record.posSpotIds
    .filter((id): id is string => typeof id === "string")
    .map((id) => id.trim())
    .filter(Boolean);

  if (posSpotIds.length === 0) {
    return NextResponse.json({ error: "posSpotIds must include at least one id" }, { status: 400 });
  }

  const locations = await readPartnerLocations();
  if (!locations.some((loc) => loc.id === partnerLocationId)) {
    return NextResponse.json({ error: "Partner Location not found" }, { status: 404 });
  }

  try {
    const result = await markPosSpotsWatered({ partnerLocationId, posSpotIds });
    return NextResponse.json({
      updatedCount: result.updatedCount,
      lastWateredAt: result.lastWateredAt,
      posSpots: result.posSpots,
    });
  } catch (err) {
    console.error("[pos-spots/water] mark failed", err);
    return NextResponse.json({ error: "Could not mark plants as watered" }, { status: 500 });
  }
}
