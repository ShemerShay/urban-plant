import { NextRequest, NextResponse } from "next/server";

import { getPlantById } from "@/lib/plantCatalog";
import { enrichOfferWithProduct, enrichOffersWithProduct } from "@/lib/offerEnrichment";
import { appendOffer, readOffers } from "@/lib/offerStorage";
import { inventoryTypeOrDefault, parseInventoryType } from "@/lib/inventoryType";
import type { OfferStatus } from "@/lib/offerTypes";

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

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
    const offers = await readOffers({ inventoryType });
    return NextResponse.json({ offers: await enrichOffersWithProduct(offers) });
  }
  const offers = await readOffers();
  return NextResponse.json({ offers: await enrichOffersWithProduct(offers) });
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
  const productId = cleanString(record.productId);
  const consumerPriceRaw = record.consumerPrice;
  const statusRaw = record.status;
  const requestedType = parseInventoryType(
    request.nextUrl.searchParams.get("inventoryType"),
  );

  if (!productId) {
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }
  const catalogProduct = await getPlantById(productId);
  if (!catalogProduct) {
    return NextResponse.json({ error: "productId must match a catalog plant" }, { status: 400 });
  }
  if (
    requestedType &&
    inventoryTypeOrDefault(catalogProduct.inventoryType) !== requestedType
  ) {
    return NextResponse.json(
      { error: "productId must match the requested inventoryType" },
      { status: 400 },
    );
  }

  const consumerPrice =
    typeof consumerPriceRaw === "number" && Number.isFinite(consumerPriceRaw)
      ? consumerPriceRaw
      : null;
  if (consumerPrice === null || consumerPrice < 0) {
    return NextResponse.json(
      { error: "consumerPrice must be a non-negative number" },
      { status: 400 },
    );
  }

  let status: OfferStatus | undefined;
  if (statusRaw !== undefined) {
    if (statusRaw !== "active" && statusRaw !== "inactive") {
      return NextResponse.json(
        { error: 'status must be "active" or "inactive" when provided' },
        { status: 400 },
      );
    }
    status = statusRaw;
  }

  if (typeof record.id === "string" && record.id.trim()) {
    return NextResponse.json(
      { error: "Offer id is assigned by the server (UUID). Do not send id." },
      { status: 400 },
    );
  }

  const offer = await appendOffer({
    productId,
    consumerPrice,
    ...(status ? { status } : {}),
  });

  return NextResponse.json({ offer: await enrichOfferWithProduct(offer) }, { status: 201 });
}
