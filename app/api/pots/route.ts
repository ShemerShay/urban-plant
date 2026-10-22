import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import { readPotsWithSizes } from "@/lib/potSizeStorage";
import { PotWriteError, createPot, potWriteHttp } from "@/lib/potStorage";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return unauthorized();
  const pots = await readPotsWithSizes();
  return NextResponse.json({ pots });
}

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return unauthorized();
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
  try {
    const pot = await createPot({
      name: record.name,
      nameHe: record.nameHe ?? record.name_he,
      image: record.image,
    });
    return NextResponse.json({ pot }, { status: 201 });
  } catch (error) {
    if (error instanceof PotWriteError) {
      const mapped = potWriteHttp(error);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    const message = error instanceof Error ? error.message : "Could not create pot";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
