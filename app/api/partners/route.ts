import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  createPartnerLocation,
  readPartnerLocations,
} from "@/lib/partnerLocationStorage";
import { parsePartnerBody } from "@/lib/partnerValidation";

export async function GET() {
  const partners = await readPartnerLocations();
  return NextResponse.json({ partners });
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
  if (cleanString(record.id)) {
    return NextResponse.json(
      { error: "Partner id is assigned by the server (UUID). Do not send id." },
      { status: 400 },
    );
  }

  const newId = randomUUID();
  const parsed = parsePartnerBody(record, { requireId: false, existingId: newId });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const partner = await createPartnerLocation({
      ...parsed.partner,
      id: newId,
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ partner }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create partner";
    if (message.includes("already exists")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
