import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { createPlant, CatalogPublishError, readPlants } from "@/lib/plantStorage";
import { parseInventoryType } from "@/lib/inventoryType";
import { isAdminRequest } from "@/lib/adminAuth";
import { plantToWire, plantsToWire, wireBodyToParseInput } from "@/lib/plantWire";
import { parsePlantBody, resolveCatalogPublishedInput } from "@/lib/plantValidation";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("inventoryType");
  if (raw != null && raw.trim() !== "") {
    const inventoryType = parseInventoryType(raw);
    if (!inventoryType) {
      return NextResponse.json(
        { error: "inventoryType must be plants or flowers" },
        { status: 400 },
      );
    }
    const plants = await readPlants({ inventoryType });
    return NextResponse.json({ plants: plantsToWire(plants) });
  }
  const plants = await readPlants();
  return NextResponse.json({ plants: plantsToWire(plants) });
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
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
  if (cleanString(record.id)) {
    return NextResponse.json(
      { error: "Plant id is assigned by the server (UUID). Do not send id." },
      { status: 400 },
    );
  }

  const newId = randomUUID();
  const parsed = parsePlantBody(wireBodyToParseInput(record), {
    requireId: false,
    existingId: newId,
  });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const catalogPublished = resolveCatalogPublishedInput({
    body: record,
    isAdmin: isAdminRequest(request),
  });
  if (!catalogPublished.ok) {
    return NextResponse.json(
      { error: catalogPublished.error },
      { status: catalogPublished.status },
    );
  }

  try {
    const plant = await createPlant({
      ...parsed.plant,
      id: newId,
      createdAt: new Date().toISOString(),
      catalogPublished: catalogPublished.value,
    });
    return NextResponse.json({ plant: plantToWire(plant) }, { status: 201 });
  } catch (error) {
    if (error instanceof CatalogPublishError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Could not create plant";
    if (message.includes("already exists")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
