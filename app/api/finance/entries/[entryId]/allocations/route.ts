import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import { FinanceWriteError, createFinanceAllocation } from "@/lib/finance/storage";
import { parseFinanceAllocation } from "@/lib/finance/validate";

interface RouteParams {
  params: Promise<{ entryId: string }>;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isAdminRequest(request)) return unauthorized();
  const { entryId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const parsed = parseFinanceAllocation(body as Record<string, unknown>);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    await createFinanceAllocation(decodeURIComponent(entryId).trim(), parsed.value);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof FinanceWriteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Could not save";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
