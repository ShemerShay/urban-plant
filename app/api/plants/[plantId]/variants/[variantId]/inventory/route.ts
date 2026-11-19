import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import {
  InventoryChangeError,
  applyInventoryDelta,
  getInventoryQuantity,
} from "@/lib/inventoryStorage";
import {
  PlantVariantWriteError,
  getPlantVariantById,
  plantVariantWriteHttp,
} from "@/lib/plantVariantStorage";

interface RouteParams {
  params: Promise<{ plantId: string; variantId: string }>;
}

const NOTE_MAX = 200;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isAdminRequest(request)) return unauthorized();
  const { plantId: rawPlantId, variantId: rawVariantId } = await params;
  const plantId = decodeURIComponent(rawPlantId).trim();
  const variantId = decodeURIComponent(rawVariantId).trim();

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
  const delta = record.delta;
  const noteRaw = record.note;
  let note: string | undefined;
  if (noteRaw !== undefined && noteRaw !== null && noteRaw !== "") {
    if (typeof noteRaw !== "string") {
      return NextResponse.json({ error: "note must be a string" }, { status: 400 });
    }
    note = noteRaw.trim();
    if (!note) note = undefined;
    else if (note.length > NOTE_MAX) {
      return NextResponse.json(
        { error: "note must be at most 200 characters" },
        { status: 400 },
      );
    }
  }

  try {
    const variant = await getPlantVariantById(variantId);
    if (!variant || variant.plantId !== plantId) {
      throw new PlantVariantWriteError("not_found", "Variant not found");
    }
    if (typeof delta !== "number" || !Number.isInteger(delta)) {
      throw new InventoryChangeError(
        "invalid_delta",
        "Inventory delta must be a non-zero integer",
      );
    }
    const balance = await applyInventoryDelta({
      variantId,
      delta,
      ...(note ? { note } : {}),
    });
    const quantity = await getInventoryQuantity(variantId);
    return NextResponse.json({
      variantId,
      quantity,
      updatedAt: balance.updatedAt,
    });
  } catch (error) {
    if (error instanceof PlantVariantWriteError) {
      const mapped = plantVariantWriteHttp(error);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    if (error instanceof InventoryChangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Could not adjust inventory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
