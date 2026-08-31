import "server-only";

import type { AnalyticsInventoryFilter } from "@/lib/analytics/analyticsQuery";
import { sql } from "@/lib/db";
import type { InventoryType } from "@/lib/inventoryType";

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
type IdRow = { id: string };

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

/** Add partner IDs / name needles here to widen purchase KPIs without rewriting queries. */
const ANALYTICS_PARTNER_NAME_NEEDLE = "%alon shabo%";
const ANALYTICS_PARTNER_IDS = [
  "0d11277b-9b47-45a5-ad80-22cf5c1ad2ef",
  "ef33137e-fe13-4be3-84bb-1f5b80557815",
] as const;

export async function listPlantIdsByInventoryType(
  inventoryType: InventoryType,
): Promise<string[]> {
  const rows = (await sql`
    SELECT id
    FROM plants
    WHERE inventory_type = ${inventoryType}
  `) as IdRow[];
  return rows.map((r) => r.id).filter((id) => typeof id === "string" && id.trim() !== "");
}

export type NeonPurchaseAnalyticsInput = {
  startInclusive: Date;
  endExclusive: Date;
  inventoryType: AnalyticsInventoryFilter;
};

/**
 * Verified successful orders only (sold / picked_up / delivered).
 * Bounds are [startInclusive, endExclusive).
 */
export async function getNeonPurchaseAnalytics(
  input: NeonPurchaseAnalyticsInput,
): Promise<NeonPurchaseAnalytics> {
  const startIso = input.startInclusive.toISOString();
  const endIso = input.endExclusive.toISOString();
  const typeParam = input.inventoryType === "all" ? null : input.inventoryType;

  const [totalRaw, plantRaw, partnerRaw] = await Promise.all([
    sql`
      SELECT
        COUNT(*)::int AS cnt,
        COUNT(*) FILTER (
          WHERE COALESCE(pl.inventory_type, 'plants') = 'plants'
        )::int AS plants_cnt,
        COUNT(*) FILTER (
          WHERE COALESCE(pl.inventory_type, 'plants') = 'flowers'
        )::int AS flowers_cnt,
        COUNT(*) FILTER (WHERE pl.id IS NULL)::int AS missing_catalog_cnt
      FROM orders o
      LEFT JOIN plants pl ON pl.id = o.product_id
      WHERE o.order_status IN ('sold', 'picked_up', 'delivered')
        AND o.created_at >= ${startIso}::timestamptz
        AND o.created_at < ${endIso}::timestamptz
        AND (
          o.partner_location_name ILIKE ${ANALYTICS_PARTNER_NAME_NEEDLE}
          OR o.partner_location_id = ANY(${[...ANALYTICS_PARTNER_IDS]})
        )
        AND LOWER(COALESCE(o.product_name, '')) NOT LIKE '%test%'
        AND LOWER(COALESCE(o.partner_location_name, '')) NOT LIKE '%test%'
        AND LOWER(COALESCE(o.full_name, '')) NOT LIKE '%shemer%'
        AND LOWER(COALESCE(o.full_name, '')) NOT LIKE '%asaf%'
        AND LOWER(COALESCE(o.full_name, '')) NOT LIKE '%שמר%'
        AND LOWER(COALESCE(o.customer_email, '')) NOT LIKE '%shemer%'
        AND LOWER(COALESCE(o.customer_email, '')) NOT LIKE '%asaf%'
        AND LOWER(COALESCE(o.customer_email, '')) NOT LIKE '%doh%'
        AND LOWER(COALESCE(o.customer_email, '')) NOT LIKE '%sh50%'
        AND LOWER(COALESCE(o.customer_email, '')) NOT LIKE '%dohsh50%'
        AND (
          ${typeParam}::text IS NULL
          OR COALESCE(pl.inventory_type, 'plants') = ${typeParam}
        )
    `,
    sql`
      SELECT
        COALESCE(
          NULLIF(TRIM(o.product_name), ''),
          NULLIF(TRIM(o.snapshot->>'productName'), ''),
          o.product_id,
          'Unknown product'
        ) AS name,
        COUNT(*)::int AS cnt
      FROM orders o
      LEFT JOIN plants pl ON pl.id = o.product_id
      WHERE o.order_status IN ('sold', 'picked_up', 'delivered')
        AND o.created_at >= ${startIso}::timestamptz
        AND o.created_at < ${endIso}::timestamptz
        AND (
          o.partner_location_name ILIKE ${ANALYTICS_PARTNER_NAME_NEEDLE}
          OR o.partner_location_id = ANY(${[...ANALYTICS_PARTNER_IDS]})
        )
        AND LOWER(COALESCE(o.product_name, '')) NOT LIKE '%test%'
        AND LOWER(COALESCE(o.partner_location_name, '')) NOT LIKE '%test%'
        AND LOWER(COALESCE(o.full_name, '')) NOT LIKE '%shemer%'
        AND LOWER(COALESCE(o.full_name, '')) NOT LIKE '%asaf%'
        AND LOWER(COALESCE(o.full_name, '')) NOT LIKE '%שמר%'
        AND LOWER(COALESCE(o.customer_email, '')) NOT LIKE '%shemer%'
        AND LOWER(COALESCE(o.customer_email, '')) NOT LIKE '%asaf%'
        AND LOWER(COALESCE(o.customer_email, '')) NOT LIKE '%doh%'
        AND LOWER(COALESCE(o.customer_email, '')) NOT LIKE '%sh50%'
        AND LOWER(COALESCE(o.customer_email, '')) NOT LIKE '%dohsh50%'
        AND (
          ${typeParam}::text IS NULL
          OR COALESCE(pl.inventory_type, 'plants') = ${typeParam}
        )
      GROUP BY 1
      ORDER BY cnt DESC, name ASC
      LIMIT 20
    `,
    sql`
      SELECT
        COALESCE(
          NULLIF(TRIM(o.partner_location_name), ''),
          NULLIF(TRIM(o.snapshot->>'partnerLocationName'), ''),
          NULLIF(TRIM(o.partner_location_id), ''),
          'Unknown partner'
        ) AS name,
        COUNT(*)::int AS cnt
      FROM orders o
      LEFT JOIN plants pl ON pl.id = o.product_id
      WHERE o.order_status IN ('sold', 'picked_up', 'delivered')
        AND o.created_at >= ${startIso}::timestamptz
        AND o.created_at < ${endIso}::timestamptz
        AND (
          o.partner_location_name ILIKE ${ANALYTICS_PARTNER_NAME_NEEDLE}
          OR o.partner_location_id = ANY(${[...ANALYTICS_PARTNER_IDS]})
        )
        AND LOWER(COALESCE(o.product_name, '')) NOT LIKE '%test%'
        AND LOWER(COALESCE(o.partner_location_name, '')) NOT LIKE '%test%'
        AND LOWER(COALESCE(o.full_name, '')) NOT LIKE '%shemer%'
        AND LOWER(COALESCE(o.full_name, '')) NOT LIKE '%asaf%'
        AND LOWER(COALESCE(o.full_name, '')) NOT LIKE '%שמר%'
        AND LOWER(COALESCE(o.customer_email, '')) NOT LIKE '%shemer%'
        AND LOWER(COALESCE(o.customer_email, '')) NOT LIKE '%asaf%'
        AND LOWER(COALESCE(o.customer_email, '')) NOT LIKE '%doh%'
        AND LOWER(COALESCE(o.customer_email, '')) NOT LIKE '%sh50%'
        AND LOWER(COALESCE(o.customer_email, '')) NOT LIKE '%dohsh50%'
        AND (
          ${typeParam}::text IS NULL
          OR COALESCE(pl.inventory_type, 'plants') = ${typeParam}
        )
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
      name: (r.name ?? "").trim() || "Unknown product",
      count: toCount(r.cnt),
    })),
    byPartner: partnerRows.map((r) => ({
      name: (r.name ?? "").trim() || "Unknown partner",
      count: toCount(r.cnt),
    })),
  };
}
