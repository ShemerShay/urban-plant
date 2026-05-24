import { NextRequest, NextResponse } from "next/server";

import {
  getPartnerLocationById,
  updatePartnerLocation,
} from "@/lib/partnerLocationStorage";
import { parsePartnerBody } from "@/lib/partnerValidation";

interface RouteParams {
  params: Promise<{ partnerId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { partnerId: rawId } = await params;
  const partnerId = decodeURIComponent(rawId);

  const existing = await getPartnerLocationById(partnerId);
  if (!existing) {
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

  const record = body as Record<string, unknown>;
  const parsed = parsePartnerBody(
    { ...record, id: partnerId },
    { requireId: false, existingId: partnerId },
  );
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const partner = await updatePartnerLocation(partnerId, {
      ...parsed.partner,
      ...(existing.createdAt ? { createdAt: existing.createdAt } : {}),
    });
    if (!partner) {
      return NextResponse.json({ error: "Partner not found" }, { status: 404 });
    }
    return NextResponse.json({ partner });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update partner";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
