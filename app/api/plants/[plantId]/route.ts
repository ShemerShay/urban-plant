import { NextRequest, NextResponse } from "next/server";

import { getPlantByIdAsync, updatePlant, deletePlant } from "@/lib/plantStorage";
import { plantToWire, wireBodyToParseInput } from "@/lib/plantWire";
import { parsePlantBody } from "@/lib/plantValidation";

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
  const parsed = parsePlantBody(wireBodyToParseInput({ ...record, id: plantId }), {
    requireId: false,
    existingId: plantId,
  });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const plant = await updatePlant(plantId, {
      ...parsed.plant,
      ...(existing.createdAt ? { createdAt: existing.createdAt } : {}),
    });
    if (!plant) {
      return NextResponse.json({ error: "Plant not found" }, { status: 404 });
    }
    return NextResponse.json({ plant: plantToWire(plant) });
  } catch (error) {
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
