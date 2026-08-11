import "server-only";

import { sql } from "@/lib/db";

export type NamedCount = {
  name: string;
  count: number;
};

export type NeonPurchaseAnalytics = {
  purchases: number;
  topPlants: NamedCount[];
  byPartner: NamedCount[];
};

type CountRow = { cnt: string | number };
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
          SELECT COUNT(*)::int AS cnt
          FROM orders
          WHERE order_status IN ('sold', 'picked_up', 'delivered')
            AND created_at >= ${fromIso}::timestamptz
        `
      : sql`
          SELECT COUNT(*)::int AS cnt
          FROM orders
          WHERE order_status IN ('sold', 'picked_up', 'delivered')
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

  return {
    purchases: toCount(totalRows[0]?.cnt),
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
