import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import { getPlantById } from "@/lib/plantCatalog";
import { enrichOfferWithProduct, enrichOffersWithProduct } from "@/lib/offerEnrichment";
import {
  OfferWriteError,
  appendFlowerOffer,
  createOrReusePlantOffer,
  offerWriteHttp,
  readOffers,
} from "@/lib/offerStorage";
import { inventoryTypeOrDefault, parseInventoryType } from "@/lib/inventoryType";
import type { OfferStatus } from "@/lib/offerTypes";

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function offerError(error: unknown, fallback: string) {
  if (error instanceof OfferWriteError) {
    const http = offerWriteHttp(error);
    return NextResponse.json({ error: http.error }, { status: http.status });
  }
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 500 });
}

function readStatus(value: unknown): OfferStatus | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (value === "active" || value === "inactive") return value;
  return "invalid";
}

function readConsumerPrice(value: unknown): number | "invalid" {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "invalid";
  return value;
}

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return unauthorized();

  const raw = request.nextUrl.searchParams.get("inventoryType");
  if (raw != null && raw.trim() !== "") {
    const inventoryType = parseInventoryType(raw);
    if (!inventoryType) {
      return NextResponse.json(
        { error: "inventoryType must be plants or flowers" },
        { status: 400 },
      );
    }
    const offers = await readOffers({ inventoryType });
    return NextResponse.json({ offers: await enrichOffersWithProduct(offers) });
  }
  const offers = await readOffers();
  return NextResponse.json({ offers: await enrichOffersWithProduct(offers) });
}

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return unauthorized();

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
  const requestedType = parseInventoryType(request.nextUrl.searchParams.get("inventoryType"));
  const status = readStatus(record.status);
  if (status === "invalid") {
    return NextResponse.json(
      { error: 'status must be "active" or "inactive" when provided' },
      { status: 400 },
    );
  }

  if (typeof record.id === "string" && record.id.trim()) {
    return NextResponse.json(
      { error: "Offer id is assigned by the server (UUID). Do not send id." },
      { status: 400 },
    );
  }
  if ("variantId" in record) {
    return NextResponse.json({ error: "variantId cannot be set" }, { status: 400 });
  }

  if (requestedType === "flowers") {
    if ("sellableVariantId" in record || "availabilities" in record) {
      return NextResponse.json(
        { error: "Flower offers cannot use a sellable variant or availabilities" },
        { status: 400 },
      );
    }
    const productId = cleanString(record.productId);
    if (!productId) {
      return NextResponse.json({ error: "productId is required" }, { status: 400 });
    }
    const catalogProduct = await getPlantById(productId);
    if (!catalogProduct) {
      return NextResponse.json({ error: "productId must match a catalog plant" }, { status: 400 });
    }
    if (inventoryTypeOrDefault(catalogProduct.inventoryType) !== "flowers") {
      return NextResponse.json(
        { error: "productId must match the requested inventoryType" },
        { status: 400 },
      );
    }
    const consumerPrice = readConsumerPrice(record.consumerPrice);
    if (consumerPrice === "invalid") {
      return NextResponse.json(
        { error: "consumerPrice must be a non-negative number" },
        { status: 400 },
      );
    }
    try {
      const offer = await appendFlowerOffer({
        productId,
        consumerPrice,
        ...(status ? { status } : {}),
      });
      return NextResponse.json({ offer: await enrichOfferWithProduct(offer) }, { status: 201 });
    } catch (error) {
      return offerError(error, "Could not create offer");
    }
  }

  const consumerPrice = readConsumerPrice(record.consumerPrice);
  if (consumerPrice === "invalid") {
    return NextResponse.json(
      { error: "consumerPrice must be a non-negative number" },
      { status: 400 },
    );
  }
  const sellableVariantId = cleanString(record.sellableVariantId);
  if (!sellableVariantId) {
    return NextResponse.json({ error: "sellableVariantId is required" }, { status: 400 });
  }

  try {
    const result = await createOrReusePlantOffer({
      sellableVariantId,
      consumerPrice,
      ...(status ? { status } : {}),
      availabilities: "availabilities" in record ? record.availabilities : undefined,
      ...(record.productId !== undefined ? { productId: cleanString(record.productId) } : {}),
      ...(requestedType ? { inventoryType: requestedType } : {}),
    });
    return NextResponse.json(
      {
        offer: await enrichOfferWithProduct(result.offer),
        ...(result.reused ? { reused: true } : {}),
      },
      { status: 201 },
    );
  } catch (error) {
    return offerError(error, "Could not create offer");
  }
}
