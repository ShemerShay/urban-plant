import { NextRequest, NextResponse } from "next/server";

import { getPartnerById } from "@/lib/partnerStorage";
import {
  PartnerCommissionAgreementLockedError,
  readPartnerCommissionTiers,
  replacePartnerCommissionTiers,
} from "@/lib/partnerCommissionStorage";
import { parsePartnerCommissionTiersBody } from "@/lib/partnerCommissionValidation";

interface RouteParams {
  params: Promise<{ brandId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { brandId } = await params;
  const id = decodeURIComponent(brandId);
  const partner = await getPartnerById(id);
  if (!partner) {
    return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  }
  const tiers = await readPartnerCommissionTiers(id);
  return NextResponse.json({ partnerId: id, tiers });
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { brandId } = await params;
  const id = decodeURIComponent(brandId);
  const partner = await getPartnerById(id);
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

  const parsed = parsePartnerCommissionTiersBody(body as Record<string, unknown>);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const tiers = await replacePartnerCommissionTiers(id, parsed.value);
    return NextResponse.json({ partnerId: id, tiers });
  } catch (error) {
    if (error instanceof PartnerCommissionAgreementLockedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Could not update commission tiers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
