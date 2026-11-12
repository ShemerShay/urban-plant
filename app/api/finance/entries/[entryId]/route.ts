import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import { FinanceWriteError, deleteManualFinanceEntry } from "@/lib/finance/storage";

interface RouteParams {
  params: Promise<{ entryId: string }>;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isAdminRequest(request)) return unauthorized();
  const { entryId } = await params;
  try {
    await deleteManualFinanceEntry(decodeURIComponent(entryId).trim());
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof FinanceWriteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Could not remove";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
