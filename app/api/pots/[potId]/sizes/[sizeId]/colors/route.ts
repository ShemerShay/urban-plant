import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import { createPotColor } from "@/lib/potSizeStorage";
import { PotWriteError, potWriteHttp } from "@/lib/potStorage";

interface RouteParams {
  params: Promise<{ potId: string; sizeId: string }>;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isAdminRequest(request)) return unauthorized();
  const { potId: rawPotId, sizeId: rawSizeId } = await params;
  const potId = decodeURIComponent(rawPotId).trim();
  const sizeId = decodeURIComponent(rawSizeId).trim();
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
    const color = await createPotColor({
      potId,
      sizeId,
      color: record.color,
      colorHe: record.colorHe ?? record.color_he,
    });
    return NextResponse.json({ color }, { status: 201 });
  } catch (error) {
    if (error instanceof PotWriteError) {
      const mapped = potWriteHttp(error);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    const message = error instanceof Error ? error.message : "Could not create color";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
