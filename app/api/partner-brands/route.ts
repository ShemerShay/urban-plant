import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { parsePartnerBrandBody } from "@/lib/partnerBrandValidation";
import { readPartnerCommissionTiers } from "@/lib/partnerCommissionStorage";
import { createPartner, readPartners } from "@/lib/partnerStorage";

export async function GET() {
  const partners = await readPartners();
  const withTiers = await Promise.all(
    partners.map(async (partner) => ({
      ...partner,
      commissionTiers: await readPartnerCommissionTiers(partner.id),
    })),
  );
  return NextResponse.json({ partners: withTiers });
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

  const parsed = parsePartnerBrandBody(body as Record<string, unknown>);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const partner = await createPartner({ id: randomUUID(), ...parsed.value });
    const commissionTiers = await readPartnerCommissionTiers(partner.id);
    return NextResponse.json({ partner: { ...partner, commissionTiers } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create partner";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
