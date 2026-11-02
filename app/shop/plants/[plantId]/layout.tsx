import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { readCatalogShopDetail } from "@/lib/catalogShop";

/**
 * Resolve the plant before the segment loading UI.
 * A sibling loading.tsx must not wrap this check, or missing IDs can stream as HTTP 200.
 */
export default async function ShopPlantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ plantId: string }>;
}) {
  const { plantId: rawId } = await params;
  const plantId = decodeURIComponent(rawId).trim();
  const plant = await readCatalogShopDetail(plantId);
  if (!plant) notFound();
  return children;
}
