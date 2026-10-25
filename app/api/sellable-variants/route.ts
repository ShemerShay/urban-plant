import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import { readSellableVariantChoices } from "@/lib/sellableVariantStorage";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return unauthorized();
  try {
    const sellableVariants = await readSellableVariantChoices();
    return NextResponse.json({ sellableVariants });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load variants";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
