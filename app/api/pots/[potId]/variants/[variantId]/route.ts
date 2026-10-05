import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import { PotWriteError, deletePotVariant, potWriteHttp, updatePotVariant } from "@/lib/potStorage";

interface RouteParams {
  params: Promise<{ potId: string; variantId: string }>;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  if (!isAdminRequest(request)) return unauthorized();
  const { potId: rawPotId, variantId: rawVariantId } = await params;
  const potId = decodeURIComponent(rawPotId).trim();
  const variantId = decodeURIComponent(rawVariantId).trim();
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
  try {
    const variant = await updatePotVariant({
      potId,
      variantId,
      ...(record.sizeLabel !== undefined || record.size_label !== undefined
        ? { sizeLabel: record.sizeLabel ?? record.size_label }
        : {}),
      ...(record.color !== undefined ? { color: record.color } : {}),
      ...(record.colorHe !== undefined || record.color_he !== undefined
        ? { colorHe: record.colorHe ?? record.color_he }
        : {}),
      ...(record.catalogPrice !== undefined || record.catalog_price !== undefined
        ? { catalogPrice: record.catalogPrice ?? record.catalog_price }
        : {}),
    });
    return NextResponse.json({ variant });
  } catch (error) {
    if (error instanceof PotWriteError) {
      const mapped = potWriteHttp(error);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    const message = error instanceof Error ? error.message : "Could not save pot variant";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isAdminRequest(request)) return unauthorized();
  const { potId: rawPotId, variantId: rawVariantId } = await params;
  try {
    await deletePotVariant({
      potId: decodeURIComponent(rawPotId).trim(),
      variantId: decodeURIComponent(rawVariantId).trim(),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PotWriteError) {
      const mapped = potWriteHttp(error);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    const message = error instanceof Error ? error.message : "Could not delete pot variant";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
