import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import {
  PlantVariantWriteError,
  deletePlantVariant,
  plantVariantWriteHttp,
  updatePlantVariant,
} from "@/lib/plantVariantStorage";

interface RouteParams {
  params: Promise<{ plantId: string; variantId: string }>;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
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

  try {
    const variant = await updatePlantVariant({
      plantId,
      variantId,
      ...(record.sizeLabel !== undefined || record.size_label !== undefined
        ? { sizeLabel: record.sizeLabel ?? record.size_label }
        : {}),
      ...(record.nurseryPotDiameterCm !== undefined ||
      record.nursery_pot_diameter_cm !== undefined
        ? {
            nurseryPotDiameterCm:
              record.nurseryPotDiameterCm ?? record.nursery_pot_diameter_cm,
          }
        : {}),
      ...(record.catalogPrice !== undefined || record.catalog_price !== undefined
        ? { catalogPrice: record.catalogPrice ?? record.catalog_price }
        : {}),
      plantIdFromBody: record.plantId ?? record.plant_id,
    });
    return NextResponse.json({ variant });
  } catch (error) {
    if (error instanceof PlantVariantWriteError) {
      const mapped = plantVariantWriteHttp(error);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    const message = error instanceof Error ? error.message : "Could not update variant";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isAdminRequest(request)) return unauthorized();
  const { plantId: rawPlantId, variantId: rawVariantId } = await params;
  const plantId = decodeURIComponent(rawPlantId).trim();
  const variantId = decodeURIComponent(rawVariantId).trim();

  try {
    await deletePlantVariant({ plantId, variantId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PlantVariantWriteError) {
      const mapped = plantVariantWriteHttp(error);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    const message = error instanceof Error ? error.message : "Could not delete variant";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
