import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import { createPotSize } from "@/lib/potSizeStorage";
import { PotWriteError, potWriteHttp } from "@/lib/potStorage";

interface RouteParams {
  params: Promise<{ potId: string }>;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isAdminRequest(request)) return unauthorized();
  const { potId: rawId } = await params;
  const potId = decodeURIComponent(rawId).trim();
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
    const size = await createPotSize({
      potId,
      sizeLabel: record.sizeLabel ?? record.size_label,
      supplierPrice: record.supplierPrice ?? record.supplier_price,
    });
    return NextResponse.json({ size }, { status: 201 });
  } catch (error) {
    if (error instanceof PotWriteError) {
      const mapped = potWriteHttp(error);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    const message = error instanceof Error ? error.message : "Could not create pot size";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
