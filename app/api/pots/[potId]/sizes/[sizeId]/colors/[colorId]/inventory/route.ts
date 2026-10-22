import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import { PotInventoryChangeError, applyPotInventoryDelta, getPotInventoryQuantity } from "@/lib/potInventoryStorage";

interface RouteParams {
  params: Promise<{ potId: string; sizeId: string; colorId: string }>;
}

const NOTE_MAX = 200;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isAdminRequest(request)) return unauthorized();
  const { potId: rawPotId, sizeId: rawSizeId, colorId: rawColorId } = await params;
  const potId = decodeURIComponent(rawPotId).trim();
  const sizeId = decodeURIComponent(rawSizeId).trim();
  const colorId = decodeURIComponent(rawColorId).trim();

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
  const noteRaw = record.note;
  if (typeof noteRaw !== "string" || !noteRaw.trim()) {
    return NextResponse.json({ error: "note is required" }, { status: 400 });
  }
  const note = noteRaw.trim();
  if (note.length > NOTE_MAX) {
    return NextResponse.json({ error: "note must be at most 200 characters" }, { status: 400 });
  }
  if (typeof record.delta !== "number" || !Number.isInteger(record.delta)) {
    return NextResponse.json({ error: "delta must be a non-zero integer" }, { status: 400 });
  }

  try {
    const balance = await applyPotInventoryDelta({
      potId,
      sizeId,
      potColorId: colorId,
      delta: record.delta,
      note,
    });
    const quantity = await getPotInventoryQuantity(colorId);
    return NextResponse.json({
      potColorId: balance.potColorId,
      quantity,
      updatedAt: balance.updatedAt,
    });
  } catch (error) {
    if (error instanceof PotInventoryChangeError) {
      const status = error.code === "color_not_found" ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    const message = error instanceof Error ? error.message : "Could not adjust inventory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
