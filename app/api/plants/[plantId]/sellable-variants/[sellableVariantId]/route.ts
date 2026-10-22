import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import {
  SellableVariantWriteError,
  deleteSellableVariant,
  sellableVariantWriteHttp,
} from "@/lib/sellableVariantStorage";

interface RouteParams {
  params: Promise<{ plantId: string; sellableVariantId: string }>;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isAdminRequest(request)) return unauthorized();
  const { plantId: rawPlantId, sellableVariantId: rawId } = await params;
  const plantId = decodeURIComponent(rawPlantId).trim();
  const sellableVariantId = decodeURIComponent(rawId).trim();
  try {
    await deleteSellableVariant({ plantId, sellableVariantId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SellableVariantWriteError) {
      const http = sellableVariantWriteHttp(error);
      return NextResponse.json({ error: http.error }, { status: http.status });
    }
    const message = error instanceof Error ? error.message : "Could not delete variant";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
