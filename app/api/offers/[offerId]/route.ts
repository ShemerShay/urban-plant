import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import { getPlantById } from "@/lib/plantCatalog";
import { enrichOfferWithProduct } from "@/lib/offerEnrichment";
import { OfferWriteError, getOfferById, offerWriteHttp, updateOffer } from "@/lib/offerStorage";
import { inventoryTypeOrDefault } from "@/lib/inventoryType";
import type { OfferStatus } from "@/lib/offerTypes";

interface RouteParams {
  params: Promise<{ offerId: string }>;
}

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

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  if (!isAdminRequest(request)) return unauthorized();

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

  const flowerOrLegacy = !existing.sellableVariantId;
  const existingProduct = await getPlantById(existing.productId);
  const existingIsFlower =
    existingProduct != null && inventoryTypeOrDefault(existingProduct.inventoryType) === "flowers";
  if ((flowerOrLegacy || existingIsFlower) && ("sellableVariantId" in record || "availabilities" in record)) {
    return NextResponse.json(
      {
        error: existingIsFlower
          ? "Flower offers cannot use a sellable variant or availabilities"
          : "This offer cannot gain a variant or availabilities",
      },
      { status: 400 },
    );
  }

  if ("variantId" in record) {
    return NextResponse.json({ error: "variantId cannot be set" }, { status: 400 });
  }

  const productId =
    record.productId !== undefined ? cleanString(record.productId) : undefined;
  if (productId !== undefined) {
    if (!productId) {
      return NextResponse.json({ error: "productId is required" }, { status: 400 });
    }
    if (existing.sellableVariantId && productId !== existing.productId) {
      return NextResponse.json(
        { error: "productId does not match the selected variant" },
        { status: 400 },
      );
    }
    const nextProduct = await getPlantById(productId);
    if (!nextProduct) {
      return NextResponse.json({ error: "productId must match a catalog plant" }, { status: 400 });
    }
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
    if (typeof record.consumerPrice !== "number" || !Number.isFinite(record.consumerPrice) || record.consumerPrice < 0) {
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

  let sellableVariantId: string | undefined;
  if ("sellableVariantId" in record) {
    sellableVariantId = cleanString(record.sellableVariantId);
  }

  try {
    const offer = await updateOffer(offerId, {
      ...(productId !== undefined ? { productId } : {}),
      ...(consumerPrice !== undefined ? { consumerPrice } : {}),
      ...(status ? { status } : {}),
      ...(sellableVariantId !== undefined ? { sellableVariantId } : {}),
      ...("availabilities" in record ? { availabilities: record.availabilities } : {}),
    });
    if (!offer) {
      return NextResponse.json({ error: "Offer not found" }, { status: 404 });
    }
    return NextResponse.json({ offer: await enrichOfferWithProduct(offer) });
  } catch (error) {
    return offerError(error, "Could not save offer");
  }
}
