import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import {
  CatalogPublishError,
  deletePlant,
  getPlantByIdAsync,
  updatePlant,
} from "@/lib/plantStorage";
import { plantToWire } from "@/lib/plantWire";
import {
  localizedFieldFromBody,
  parsePlantBody,
  resolveCatalogPublishedInput,
} from "@/lib/plantValidation";

interface RouteParams {
  params: Promise<{ plantId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { plantId: rawId } = await params;
  const plantId = decodeURIComponent(rawId);

  const existing = await getPlantByIdAsync(plantId);
  if (!existing) {
    return NextResponse.json({ error: "Plant not found" }, { status: 404 });
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
  const parsed = parsePlantBody({ ...record, id: plantId }, {
    requireId: false,
    existingId: plantId,
  });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const catalogPublished = resolveCatalogPublishedInput({
    body: record,
    isAdmin: isAdminRequest(request),
    existing: existing.catalogPublished === true,
  });
  if (!catalogPublished.ok) {
    return NextResponse.json(
      { error: catalogPublished.error },
      { status: catalogPublished.status },
    );
  }

  try {
    const plant = await updatePlant(plantId, {
      ...parsed.plant,
      nameHe: localizedFieldFromBody(record, existing.nameHe, "nameHe", "name_he"),
      subtitleHe: localizedFieldFromBody(
        record,
        existing.subtitleHe,
        "subtitleHe",
        "subtitle_he",
      ),
      descriptionHe: localizedFieldFromBody(
        record,
        existing.descriptionHe,
        "descriptionHe",
        "description_he",
      ),
      waterHe: localizedFieldFromBody(record, existing.waterHe, "waterHe", "water_he"),
      inventoryType: existing.inventoryType,
      catalogPublished: catalogPublished.value,
      ...(existing.createdAt ? { createdAt: existing.createdAt } : {}),
    });
    if (!plant) {
      return NextResponse.json({ error: "Plant not found" }, { status: 404 });
    }
    return NextResponse.json({ plant: plantToWire(plant) });
  } catch (error) {
    if (error instanceof CatalogPublishError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Could not update plant";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { plantId: rawId } = await params;
  const plantId = decodeURIComponent(rawId).trim();

  if (!plantId) {
    return NextResponse.json({ error: "Plant id is required" }, { status: 400 });
  }

  const existing = await getPlantByIdAsync(plantId);
  if (!existing) {
    return NextResponse.json({ error: "Plant not found" }, { status: 404 });
  }

  try {
    const deleted = await deletePlant(plantId);
    if (!deleted) {
      return NextResponse.json({ error: "Plant not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete plant";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
