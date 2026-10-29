import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import {
  SellableVariantWriteError,
  deleteSellableVariant,
  sellableVariantErrorResponse,
  updateSellableVariantPot,
} from "@/lib/sellableVariantStorage";

interface RouteParams {
  params: Promise<{ plantId: string; sellableVariantId: string }>;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  if (!isAdminRequest(request)) return unauthorized();
  const { plantId: rawPlantId, sellableVariantId: rawId } = await params;
  const plantId = decodeURIComponent(rawPlantId).trim();
  const sellableVariantId = decodeURIComponent(rawId).trim();

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
  if (
    "plantSizeId" in record ||
    "plant_size_id" in record ||
    "plantVariantId" in record ||
    "plant_variant_id" in record
  ) {
    return NextResponse.json({ error: "Plant size cannot be changed" }, { status: 400 });
  }
  if ("potColorId" in record || "pot_color_id" in record) {
    return NextResponse.json({ error: "Pot color is not part of this variant" }, { status: 400 });
  }
  if (!("potId" in record) && !("pot_id" in record)) {
    return NextResponse.json({ error: "potId is required" }, { status: 400 });
  }
  try {
    const sellableVariant = await updateSellableVariantPot({
      plantId,
      sellableVariantId,
      potId: "potId" in record ? record.potId : record.pot_id,
    });
    return NextResponse.json({ sellableVariant });
  } catch (error) {
    if (error instanceof SellableVariantWriteError) {
      const http = sellableVariantErrorResponse(error);
      return NextResponse.json(http.body, { status: http.status });
    }
    const message = error instanceof Error ? error.message : "Could not save variant";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isAdminRequest(request)) return unauthorized();
  const { plantId: rawPlantId, sellableVariantId: rawId } = await params;
  const plantId = decodeURIComponent(rawPlantId).trim();
  const sellableVariantId = decodeURIComponent(rawId).trim();
  try {
    await deleteSellableVariant({ plantId, sellableVariantId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SellableVariantWriteError) {
      const http = sellableVariantErrorResponse(error);
      return NextResponse.json(http.body, { status: http.status });
    }
    const message = error instanceof Error ? error.message : "Could not delete variant";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
