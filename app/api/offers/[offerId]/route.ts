import { NextRequest, NextResponse } from "next/server";

import { getPlantById } from "@/lib/plantCatalog";
import { enrichOfferWithProduct } from "@/lib/offerEnrichment";
import { getOfferById, updateOffer } from "@/lib/offerStorage";
import { inventoryTypeOrDefault } from "@/lib/inventoryType";
import type { OfferStatus } from "@/lib/offerTypes";

interface RouteParams {
  params: Promise<{ offerId: string }>;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { offerId: rawId } = await params;
  const offerId = decodeURIComponent(rawId);

  const existing = await getOfferById(offerId);
  if (!existing) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 });
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

  if (record.id !== undefined && cleanString(record.id) && cleanString(record.id) !== offerId) {
    return NextResponse.json({ error: "Offer id cannot be changed" }, { status: 400 });
  }

  const productId =
    record.productId !== undefined ? cleanString(record.productId) : undefined;
  if (productId !== undefined) {
    if (!productId) {
      return NextResponse.json({ error: "productId is required" }, { status: 400 });
    }
    const nextProduct = await getPlantById(productId);
    if (!nextProduct) {
      return NextResponse.json({ error: "productId must match a catalog plant" }, { status: 400 });
    }
    const existingProduct = await getPlantById(existing.productId);
    if (
      existingProduct &&
      inventoryTypeOrDefault(nextProduct.inventoryType) !==
        inventoryTypeOrDefault(existingProduct.inventoryType)
    ) {
      return NextResponse.json(
        { error: "productId must keep the same inventory type" },
        { status: 400 },
      );
    }
  }

  let consumerPrice: number | undefined;
  if (record.consumerPrice !== undefined) {
    if (typeof record.consumerPrice !== "number" || !Number.isFinite(record.consumerPrice)) {
      return NextResponse.json(
        { error: "consumerPrice must be a non-negative number" },
        { status: 400 },
      );
    }
    if (record.consumerPrice < 0) {
      return NextResponse.json(
        { error: "consumerPrice must be a non-negative number" },
        { status: 400 },
      );
    }
    consumerPrice = record.consumerPrice;
  }

  let status: OfferStatus | undefined;
  if (record.status !== undefined) {
    if (record.status !== "active" && record.status !== "inactive") {
      return NextResponse.json(
        { error: 'status must be "active" or "inactive"' },
        { status: 400 },
      );
    }
    status = record.status;
  }

  const offer = await updateOffer(offerId, {
    ...(productId !== undefined ? { productId } : {}),
    ...(consumerPrice !== undefined ? { consumerPrice } : {}),
    ...(status ? { status } : {}),
  });

  if (!offer) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  }

  return NextResponse.json({ offer: await enrichOfferWithProduct(offer) });
}
