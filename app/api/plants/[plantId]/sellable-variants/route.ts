import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import {
  SellableVariantWriteError,
  createSellableVariant,
  readSellableVariantsForPlant,
  sellableVariantWriteHttp,
} from "@/lib/sellableVariantStorage";

interface RouteParams {
  params: Promise<{ plantId: string }>;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function mapped(error: unknown, fallback: string) {
  if (error instanceof SellableVariantWriteError) {
    const http = sellableVariantWriteHttp(error);
    return NextResponse.json({ error: http.error }, { status: http.status });
  }
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isAdminRequest(request)) return unauthorized();
  const { plantId: rawId } = await params;
  const plantId = decodeURIComponent(rawId).trim();
  try {
    const sellableVariants = await readSellableVariantsForPlant(plantId);
    return NextResponse.json({ sellableVariants });
  } catch (error) {
    return mapped(error, "Could not load variants");
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
  if (!("potSizeId" in record)) {
    return NextResponse.json({ error: "potSizeId is required" }, { status: 400 });
  }
  try {
    const sellableVariant = await createSellableVariant({
      plantId,
      plantSizeId: record.plantSizeId,
      potSizeId: record.potSizeId,
    });
    return NextResponse.json({ sellableVariant }, { status: 201 });
  } catch (error) {
    return mapped(error, "Could not create variant");
  }
}
