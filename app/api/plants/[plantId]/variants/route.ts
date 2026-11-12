import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import { InventoryChangeError } from "@/lib/inventoryStorage";
import { getPlantByIdAsync } from "@/lib/plantStorage";
import {
  PlantVariantWriteError,
  createPlantSizeWithOpeningQuantity,
  parsePlantSizeOpeningQuantity,
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
    const created = await createPlantSizeWithOpeningQuantity({
      plantId,
      sizeLabel: record.sizeLabel ?? record.size_label,
      quantity: parsePlantSizeOpeningQuantity(record.quantity),
    });
    return NextResponse.json(
      { variant: created.variant, quantity: created.quantity },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof PlantVariantWriteError) {
      const mapped = plantVariantWriteHttp(error);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    if (error instanceof InventoryChangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Could not create variant";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
