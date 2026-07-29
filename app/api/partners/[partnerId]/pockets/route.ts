import { NextRequest, NextResponse } from "next/server";

import { getPartnerLocationById } from "@/lib/partnerLocationStorage";
import {
  createPocket,
  isUniqueViolation,
  PocketNameConflictError,
  readPocketsByPartner,
} from "@/lib/pocketStorage";

interface RouteParams {
  params: Promise<{ partnerId: string }>;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { partnerId: rawId } = await params;
  const partnerId = decodeURIComponent(rawId).trim();
  const partner = await getPartnerLocationById(partnerId);
  if (!partner) {
    return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  }
  const pockets = await readPocketsByPartner(partnerId);
  return NextResponse.json({ pockets });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { partnerId: rawId } = await params;
  const partnerId = decodeURIComponent(rawId).trim();
  const partner = await getPartnerLocationById(partnerId);
  if (!partner) {
    return NextResponse.json({ error: "Partner not found" }, { status: 404 });
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

  const name = cleanString((body as Record<string, unknown>).name);
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const pocket = await createPocket({ partnerLocationId: partnerId, name });
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
