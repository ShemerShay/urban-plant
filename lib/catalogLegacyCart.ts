/**
 * One-shot translation of a stored v1 Catalog cart.
 * The pot_variants read exists only here. Selling does not use it.
 */

import "server-only";

import type { CatalogCartLegacyItem, CatalogCartResolvedLine } from "@/lib/catalogCart";
import { resolveCatalogCartLines } from "@/lib/catalogShop";
import { sql } from "@/lib/db";

type LegacyPotRow = {
  id: string;
  pot_id: string;
  size_label: string;
  color: string;
};

/**
 * Map a v1 pot through pot_variants, then Pot Size, Pot Color, Sellable Variant, and Offer.
 * Does not treat potVariantId as potColorId.
 */
export async function migrateLegacyCatalogCartLines(
  items: CatalogCartLegacyItem[],
): Promise<CatalogCartResolvedLine[]> {
  const potIds = [
    ...new Set(items.map((item) => item.potVariantId).filter((id): id is string => Boolean(id))),
  ];
  const pots = new Map<string, LegacyPotRow>();
  if (potIds.length > 0) {
    const rows = await sql`
      SELECT id::text AS id, pot_id::text AS pot_id, size_label, color
      FROM pot_variants
      WHERE id = ANY(${potIds}::uuid[])
    `;
    for (const row of rows as LegacyPotRow[]) pots.set(row.id.toLowerCase(), row);
  }

  const translated: Array<{
    plantId: string;
    plantSizeId: string;
    sellableVariantId: string;
    offerId: string;
    potColorId: string | null;
    quantity: number;
  }> = [];

  for (const item of items) {
    if (!item.potVariantId) {
      const rows = await sql`
        SELECT sv.id::text AS sellable_variant_id, o.id AS offer_id
        FROM sellable_variants sv
        INNER JOIN offers o
          ON o.sellable_variant_id = sv.id
         AND o.status = 'active'
        INNER JOIN offer_availabilities a
          ON a.offer_id = o.id
         AND a.scope = 'catalog'
        WHERE sv.plant_variant_id = ${item.plantVariantId}::uuid
          AND sv.pot_size_id IS NULL
        ORDER BY sv.id ASC
        LIMIT 1
      `;
      const row = (rows as { sellable_variant_id: string; offer_id: string }[])[0];
      if (!row) continue;
      translated.push({
        plantId: item.plantId,
        plantSizeId: item.plantVariantId,
        sellableVariantId: row.sellable_variant_id,
        offerId: row.offer_id,
        potColorId: null,
        quantity: item.quantity,
      });
      continue;
    }

    const legacy = pots.get(item.potVariantId.toLowerCase());
    if (!legacy) continue;
    const rows = await sql`
      SELECT
        sv.id::text AS sellable_variant_id,
        o.id AS offer_id,
        c.id::text AS pot_color_id
      FROM pot_sizes ps
      INNER JOIN pot_colors c
        ON c.pot_size_id = ps.id
       AND lower(btrim(c.color)) = lower(btrim(${legacy.color}))
      INNER JOIN sellable_variants sv
        ON sv.plant_variant_id = ${item.plantVariantId}::uuid
       AND sv.pot_size_id = ps.id
      INNER JOIN offers o
        ON o.sellable_variant_id = sv.id
       AND o.status = 'active'
      INNER JOIN offer_availabilities a
        ON a.offer_id = o.id
       AND a.scope = 'catalog'
      WHERE ps.pot_id = ${legacy.pot_id}::uuid
        AND ps.size_label = ${legacy.size_label}
      ORDER BY c.id ASC, sv.id ASC
      LIMIT 1
    `;
    const row = (
      rows as { sellable_variant_id: string; offer_id: string; pot_color_id: string }[]
    )[0];
    if (!row) continue;
    translated.push({
      plantId: item.plantId,
      plantSizeId: item.plantVariantId,
      sellableVariantId: row.sellable_variant_id,
      offerId: row.offer_id,
      potColorId: row.pot_color_id,
      quantity: item.quantity,
    });
  }

  return resolveCatalogCartLines(translated);
}
