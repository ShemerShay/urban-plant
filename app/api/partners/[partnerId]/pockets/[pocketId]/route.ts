import { NextRequest, NextResponse } from "next/server";

import { getPartnerLocationById } from "@/lib/partnerLocationStorage";
import {
  deletePocket,
  getPocketById,
  isUniqueViolation,
  PocketNameConflictError,
  updatePocket,
} from "@/lib/pocketStorage";

interface RouteParams {
  params: Promise<{ partnerId: string; pocketId: string }>;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function loadPocketForPartner(partnerId: string, pocketId: string) {
  const partner = await getPartnerLocationById(partnerId);
  if (!partner) return { error: NextResponse.json({ error: "Partner not found" }, { status: 404 }) };
  const pocket = await getPocketById(pocketId);
  if (!pocket || pocket.partnerLocationId !== partnerId) {
    return { error: NextResponse.json({ error: "Pocket not found" }, { status: 404 }) };
  }
  return { partner, pocket };
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { partnerId: rawPartnerId, pocketId: rawPocketId } = await params;
  const partnerId = decodeURIComponent(rawPartnerId).trim();
  const pocketId = decodeURIComponent(rawPocketId).trim();
  const loaded = await loadPocketForPartner(partnerId, pocketId);
  if ("error" in loaded && loaded.error) return loaded.error;
  return NextResponse.json({ pocket: loaded.pocket });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { partnerId: rawPartnerId, pocketId: rawPocketId } = await params;
  const partnerId = decodeURIComponent(rawPartnerId).trim();
  const pocketId = decodeURIComponent(rawPocketId).trim();
  const loaded = await loadPocketForPartner(partnerId, pocketId);
  if ("error" in loaded && loaded.error) return loaded.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const name = cleanString((body as Record<string, unknown>).name);
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const pocket = await updatePocket(pocketId, { name });
    if (!pocket) {
      return NextResponse.json({ error: "Could not update pocket" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, pocket });
  } catch (err) {
    if (err instanceof PocketNameConflictError || isUniqueViolation(err)) {
      return NextResponse.json(
        { error: "A pocket with this name already exists for this partner" },
        { status: 409 },
      );
    }
    throw err;
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { partnerId: rawPartnerId, pocketId: rawPocketId } = await params;
  const partnerId = decodeURIComponent(rawPartnerId).trim();
  const pocketId = decodeURIComponent(rawPocketId).trim();
  const loaded = await loadPocketForPartner(partnerId, pocketId);
  if ("error" in loaded && loaded.error) return loaded.error;

  const result = await deletePocket(pocketId);
  if (!result.deleted) {
    return NextResponse.json({ error: "Pocket not found" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    inactivatedCount: result.inactivatedCount,
  });
}
