import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import { deletePotColor, updatePotColor } from "@/lib/potSizeStorage";
import { PotWriteError, potWriteHttp } from "@/lib/potStorage";

interface RouteParams {
  params: Promise<{ potId: string; sizeId: string; colorId: string }>;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  if (!isAdminRequest(request)) return unauthorized();
  const { potId: rawPotId, sizeId: rawSizeId, colorId: rawColorId } = await params;
  const potId = decodeURIComponent(rawPotId).trim();
  const sizeId = decodeURIComponent(rawSizeId).trim();
  const colorId = decodeURIComponent(rawColorId).trim();
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
    const color = await updatePotColor({
      potId,
      sizeId,
      colorId,
      ...(record.color !== undefined ? { color: record.color } : {}),
      ...(record.colorHe !== undefined || record.color_he !== undefined
        ? { colorHe: record.colorHe ?? record.color_he }
        : {}),
    });
    return NextResponse.json({ color });
  } catch (error) {
    if (error instanceof PotWriteError) {
      const mapped = potWriteHttp(error);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    const message = error instanceof Error ? error.message : "Could not save color";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isAdminRequest(request)) return unauthorized();
  const { potId: rawPotId, sizeId: rawSizeId, colorId: rawColorId } = await params;
  try {
    await deletePotColor({
      potId: decodeURIComponent(rawPotId).trim(),
      sizeId: decodeURIComponent(rawSizeId).trim(),
      colorId: decodeURIComponent(rawColorId).trim(),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PotWriteError) {
      const mapped = potWriteHttp(error);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    const message = error instanceof Error ? error.message : "Could not delete color";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
