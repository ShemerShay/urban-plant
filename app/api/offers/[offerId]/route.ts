import { NextRequest, NextResponse } from "next/server";

import { getPlantById } from "@/lib/plantCatalog";
import { enrichOfferWithProduct } from "@/lib/offerEnrichment";
import { getOfferById, updateOffer } from "@/lib/offerStorage";
import type { OfferStatus } from "@/lib/offerTypes";

interface RouteParams {
  params: Promise<{ offerId: string }>;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseOptionalPrice(
  raw: unknown,
  fieldName: string,
): { ok: true; value: number | null | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    return { ok: false, error: `${fieldName} must be a non-negative number or null` };
  }
  return { ok: true, value: raw };
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
    if (!(await getPlantById(productId))) {
      return NextResponse.json({ error: "productId must match a catalog plant" }, { status: 400 });
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

  const supplierPriceParsed = parseOptionalPrice(record.supplierPrice, "supplierPrice");
  if (!supplierPriceParsed.ok) {
    return NextResponse.json({ error: supplierPriceParsed.error }, { status: 400 });
  }

  let supplierName: string | null | undefined;
  if (record.supplierName !== undefined) {
    if (record.supplierName === null) {
      supplierName = null;
    } else if (typeof record.supplierName === "string") {
      supplierName = record.supplierName.trim();
    } else {
      return NextResponse.json({ error: "supplierName must be a string or null" }, { status: 400 });
    }
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
    ...(supplierPriceParsed.value !== undefined
      ? { supplierPrice: supplierPriceParsed.value }
      : {}),
    ...(supplierName !== undefined ? { supplierName } : {}),
    ...(status ? { status } : {}),
  });

  if (!offer) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  }

  return NextResponse.json({ offer: await enrichOfferWithProduct(offer) });
}
