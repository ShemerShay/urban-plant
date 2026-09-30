import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import { getPlantByIdAsync } from "@/lib/plantStorage";
import {
  PlantVariantWriteError,
  createPlantVariant,
  plantVariantWriteHttp,
  readPlantVariantsWithQuantity,
} from "@/lib/plantVariantStorage";

interface RouteParams {
  params: Promise<{ plantId: string }>;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isAdminRequest(request)) return unauthorized();
  const { plantId: rawId } = await params;
  const plantId = decodeURIComponent(rawId).trim();
  const plant = await getPlantByIdAsync(plantId);
  if (!plant) {
    return NextResponse.json({ error: "Plant not found" }, { status: 404 });
  }
  try {
    const variants = await readPlantVariantsWithQuantity(plantId);
    return NextResponse.json({ variants });
  } catch (error) {
    if (error instanceof PlantVariantWriteError) {
      const mapped = plantVariantWriteHttp(error);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    const message = error instanceof Error ? error.message : "Could not load variants";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isAdminRequest(request)) return unauthorized();
  const { plantId: rawId } = await params;
  const plantId = decodeURIComponent(rawId).trim();

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
    const variant = await createPlantVariant({
      plantId,
      sizeLabel: record.sizeLabel ?? record.size_label,
      nurseryPotDiameterCm: record.nurseryPotDiameterCm ?? record.nursery_pot_diameter_cm,
      catalogPrice: record.catalogPrice ?? record.catalog_price,
    });
    return NextResponse.json({ variant, quantity: 0 }, { status: 201 });
  } catch (error) {
    if (error instanceof PlantVariantWriteError) {
      const mapped = plantVariantWriteHttp(error);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    const message = error instanceof Error ? error.message : "Could not create variant";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
