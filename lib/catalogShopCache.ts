/**
 * Short cache for public shop listing and plant-detail reads.
 * Cart resolution, checkout, and POS eligibility do not use this cache.
 * Writers call revalidateCatalogShopCache() after a successful catalog change.
 * Outside a Next.js request the call does nothing, so scripts stay immediate.
 */

export const CATALOG_SHOP_CACHE_TAG = "catalog-shop";

/** Long enough to absorb a burst of shop views, short enough that a missed writer cannot hide stock. */
export const CATALOG_SHOP_REVALIDATE_SECONDS = 15;

export async function revalidateCatalogShopCache(): Promise<void> {
  if (!process.env.NEXT_RUNTIME) return;
  try {
    const { revalidateTag } = await import("next/cache");
    revalidateTag(CATALOG_SHOP_CACHE_TAG, { expire: 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("static generation store missing")) return;
    console.error("catalog shop cache revalidation failed:", message);
  }
}
