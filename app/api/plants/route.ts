import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { createPlant, readPlants } from "@/lib/plantStorage";
import { parsePlantBody } from "@/lib/plantValidation";

export async function GET() {
  const plants = await readPlants();
  return NextResponse.json({ plants });
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
  const parsed = parsePlantBody(record, { requireId: false, existingId: newId });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const plant = await createPlant({
      ...parsed.plant,
      id: newId,
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ plant }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create plant";
    if (message.includes("already exists")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
