import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import { deletePotSize, updatePotSize } from "@/lib/potSizeStorage";
import { PotWriteError, potWriteHttp } from "@/lib/potStorage";

interface RouteParams {
  params: Promise<{ potId: string; sizeId: string }>;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  if (!isAdminRequest(request)) return unauthorized();
  const { potId: rawPotId, sizeId: rawSizeId } = await params;
  const potId = decodeURIComponent(rawPotId).trim();
  const sizeId = decodeURIComponent(rawSizeId).trim();
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
    const size = await updatePotSize({
      potId,
      sizeId,
      ...(record.sizeLabel !== undefined || record.size_label !== undefined
        ? { sizeLabel: record.sizeLabel ?? record.size_label }
        : {}),
      ...(record.supplierPrice !== undefined || record.supplier_price !== undefined
        ? { supplierPrice: record.supplierPrice ?? record.supplier_price }
        : {}),
    });
    return NextResponse.json({ size });
  } catch (error) {
    if (error instanceof PotWriteError) {
      const mapped = potWriteHttp(error);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    const message = error instanceof Error ? error.message : "Could not save pot size";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isAdminRequest(request)) return unauthorized();
  const { potId: rawPotId, sizeId: rawSizeId } = await params;
  try {
    await deletePotSize({
      potId: decodeURIComponent(rawPotId).trim(),
      sizeId: decodeURIComponent(rawSizeId).trim(),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PotWriteError) {
      const mapped = potWriteHttp(error);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    const message = error instanceof Error ? error.message : "Could not delete pot size";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
