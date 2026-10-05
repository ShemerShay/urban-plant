import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import { PotWriteError, deletePot, potWriteHttp, updatePot } from "@/lib/potStorage";

interface RouteParams {
  params: Promise<{ potId: string }>;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
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
    const pot = await updatePot({
      potId,
      ...(record.name !== undefined ? { name: record.name } : {}),
      ...(record.nameHe !== undefined || record.name_he !== undefined
        ? { nameHe: record.nameHe ?? record.name_he }
        : {}),
      ...(record.image !== undefined ? { image: record.image } : {}),
    });
    return NextResponse.json({ pot });
  } catch (error) {
    if (error instanceof PotWriteError) {
      const mapped = potWriteHttp(error);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    const message = error instanceof Error ? error.message : "Could not save pot";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isAdminRequest(request)) return unauthorized();
  const { potId: rawId } = await params;
  const potId = decodeURIComponent(rawId).trim();
  try {
    await deletePot(potId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PotWriteError) {
      const mapped = potWriteHttp(error);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    const message = error instanceof Error ? error.message : "Could not delete pot";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
