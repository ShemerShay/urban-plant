import "server-only";

import { sql } from "@/lib/db";

export type NamedCount = {
  name: string;
  count: number;
};

export type NeonPurchaseAnalytics = {
  purchases: number;
  purchasesPlants: number;
  purchasesFlowers: number;
  /** Verified orders whose product_id did not match plants; counted as plants. */
  purchasesMissingCatalog: number;
  inventoryTypeFallback: "plants";
  topPlants: NamedCount[];
  byPartner: NamedCount[];
};

type CountRow = {
  cnt: string | number;
  plants_cnt?: string | number;
  flowers_cnt?: string | number;
  missing_catalog_cnt?: string | number;
};
type NamedCountRow = { name: string | null; cnt: string | number };

function toCount(value: string | number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function asCountRows(rows: unknown): CountRow[] {
  return rows as CountRow[];
}

function asNamedCountRows(rows: unknown): NamedCountRow[] {
  return rows as NamedCountRow[];
}

/**
 * Verified successful orders only (sold / picked_up / delivered).
 * Optional `createdAtFrom` filters by orders.created_at (inclusive lower bound).
 */
export async function getNeonPurchaseAnalytics(
  createdAtFrom: Date | null,
): Promise<NeonPurchaseAnalytics> {
  const fromIso = createdAtFrom ? createdAtFrom.toISOString() : null;

  const [totalRaw, plantRaw, partnerRaw] = await Promise.all([
    fromIso
      ? sql`
          SELECT
            COUNT(*)::int AS cnt,
            COUNT(*) FILTER (
              WHERE COALESCE(pl.inventory_type, 'plants') = 'flowers'
            )::int AS flowers_cnt,
            COUNT(*) FILTER (
              WHERE COALESCE(pl.inventory_type, 'plants') <> 'flowers'
            )::int AS plants_cnt,
            COUNT(*) FILTER (WHERE pl.id IS NULL)::int AS missing_catalog_cnt
          FROM orders o
          LEFT JOIN plants pl ON pl.id = o.product_id
          WHERE o.order_status IN ('sold', 'picked_up', 'delivered')
            AND o.created_at >= ${fromIso}::timestamptz
        `
      : sql`
          SELECT
            COUNT(*)::int AS cnt,
            COUNT(*) FILTER (
              WHERE COALESCE(pl.inventory_type, 'plants') = 'flowers'
            )::int AS flowers_cnt,
            COUNT(*) FILTER (
              WHERE COALESCE(pl.inventory_type, 'plants') <> 'flowers'
            )::int AS plants_cnt,
            COUNT(*) FILTER (WHERE pl.id IS NULL)::int AS missing_catalog_cnt
          FROM orders o
          LEFT JOIN plants pl ON pl.id = o.product_id
          WHERE o.order_status IN ('sold', 'picked_up', 'delivered')
        `,
    fromIso
      ? sql`
          SELECT
            COALESCE(
              NULLIF(TRIM(product_name), ''),
              NULLIF(TRIM(snapshot->>'productName'), ''),
              product_id,
              'Unknown plant'
            ) AS name,
            COUNT(*)::int AS cnt
          FROM orders
          WHERE order_status IN ('sold', 'picked_up', 'delivered')
            AND created_at >= ${fromIso}::timestamptz
          GROUP BY 1
          ORDER BY cnt DESC, name ASC
          LIMIT 20
        `
      : sql`
          SELECT
            COALESCE(
              NULLIF(TRIM(product_name), ''),
              NULLIF(TRIM(snapshot->>'productName'), ''),
              product_id,
              'Unknown plant'
            ) AS name,
            COUNT(*)::int AS cnt
          FROM orders
          WHERE order_status IN ('sold', 'picked_up', 'delivered')
          GROUP BY 1
          ORDER BY cnt DESC, name ASC
          LIMIT 20
        `,
    fromIso
      ? sql`
          SELECT
            COALESCE(
              NULLIF(TRIM(partner_location_name), ''),
              NULLIF(TRIM(snapshot->>'partnerLocationName'), ''),
              NULLIF(TRIM(partner_location_id), ''),
              'Unknown partner'
            ) AS name,
            COUNT(*)::int AS cnt
          FROM orders
          WHERE order_status IN ('sold', 'picked_up', 'delivered')
            AND created_at >= ${fromIso}::timestamptz
          GROUP BY 1
          ORDER BY cnt DESC, name ASC
          LIMIT 20
        `
      : sql`
          SELECT
            COALESCE(
              NULLIF(TRIM(partner_location_name), ''),
              NULLIF(TRIM(snapshot->>'partnerLocationName'), ''),
              NULLIF(TRIM(partner_location_id), ''),
              'Unknown partner'
            ) AS name,
            COUNT(*)::int AS cnt
          FROM orders
          WHERE order_status IN ('sold', 'picked_up', 'delivered')
          GROUP BY 1
          ORDER BY cnt DESC, name ASC
          LIMIT 20
        `,
  ]);

  const totalRows = asCountRows(totalRaw);
  const plantRows = asNamedCountRows(plantRaw);
  const partnerRows = asNamedCountRows(partnerRaw);

  const total = totalRows[0];
  return {
    purchases: toCount(total?.cnt),
    purchasesPlants: toCount(total?.plants_cnt),
    purchasesFlowers: toCount(total?.flowers_cnt),
    purchasesMissingCatalog: toCount(total?.missing_catalog_cnt),
    inventoryTypeFallback: "plants",
    topPlants: plantRows.map((r) => ({
      name: (r.name ?? "").trim() || "Unknown plant",
      count: toCount(r.cnt),
    })),
    byPartner: partnerRows.map((r) => ({
      name: (r.name ?? "").trim() || "Unknown partner",
      count: toCount(r.cnt),
    })),
  };
}
