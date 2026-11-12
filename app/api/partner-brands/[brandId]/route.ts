import { NextRequest, NextResponse } from "next/server";

import { parsePartnerBrandBody } from "@/lib/partnerBrandValidation";
import { readPartnerCommissionTiers } from "@/lib/partnerCommissionStorage";
import { getPartnerById, updatePartner } from "@/lib/partnerStorage";

interface RouteParams {
  params: Promise<{ brandId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { brandId } = await params;
  const partner = await getPartnerById(decodeURIComponent(brandId));
  if (!partner) {
    return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  }
  const commissionTiers = await readPartnerCommissionTiers(partner.id);
  return NextResponse.json({ partner: { ...partner, commissionTiers } });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { brandId } = await params;
  const id = decodeURIComponent(brandId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const parsed = parsePartnerBrandBody(body as Record<string, unknown>);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const partner = await updatePartner(id, parsed.value);
    if (!partner) {
      return NextResponse.json({ error: "Partner not found" }, { status: 404 });
    }
    return NextResponse.json({ partner });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update partner";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
