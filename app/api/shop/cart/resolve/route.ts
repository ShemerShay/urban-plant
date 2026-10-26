import { NextRequest, NextResponse } from "next/server";

import { parseCatalogCartRequest } from "@/lib/catalogCart";
import { migrateLegacyCatalogCartLines } from "@/lib/catalogLegacyCart";
import { resolveCatalogCartLines } from "@/lib/catalogShop";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const requested = parseCatalogCartRequest(body);
  if (!requested) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const resolved =
    requested.v === 1
      ? await migrateLegacyCatalogCartLines(requested.items)
      : await resolveCatalogCartLines(requested.items);
  return NextResponse.json({ items: resolved });
}
