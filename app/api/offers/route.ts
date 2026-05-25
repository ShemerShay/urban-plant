import { NextRequest, NextResponse } from "next/server";

import { getPlantById } from "@/lib/plantCatalog";
import { enrichOfferWithProduct, enrichOffersWithProduct } from "@/lib/offerEnrichment";
import { appendOffer, readOffers } from "@/lib/offerStorage";
import type { OfferStatus } from "@/lib/offerTypes";

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
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
  const supplierPriceRaw = record.supplierPrice;
  const supplierName = cleanString(record.supplierName);
  const statusRaw = record.status;

  if (!productId) {
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }
  if (!(await getPlantById(productId))) {
    return NextResponse.json({ error: "productId must match a catalog plant" }, { status: 400 });
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

  let supplierPrice: number | undefined;
  if (supplierPriceRaw !== undefined && supplierPriceRaw !== null) {
    if (typeof supplierPriceRaw !== "number" || !Number.isFinite(supplierPriceRaw) || supplierPriceRaw < 0) {
      return NextResponse.json(
        { error: "supplierPrice must be a non-negative number when provided" },
        { status: 400 },
      );
    }
    supplierPrice = supplierPriceRaw;
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
    ...(supplierPrice !== undefined ? { supplierPrice } : {}),
    ...(supplierName ? { supplierName } : {}),
    ...(status ? { status } : {}),
  });

  return NextResponse.json({ offer: await enrichOfferWithProduct(offer) }, { status: 201 });
}
