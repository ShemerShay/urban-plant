import { NextRequest, NextResponse } from "next/server";

import { getPlantByIdAsync, updatePlant } from "@/lib/plantStorage";
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
  const parsed = parsePlantBody(
    { ...record, id: plantId },
    { requireId: false, existingId: plantId },
  );
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
    return NextResponse.json({ plant });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update plant";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
