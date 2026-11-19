import "server-only";

import type { AnalyticsInventoryFilter } from "@/lib/analytics/analyticsQuery";
import { sql } from "@/lib/db";
import type { InventoryType } from "@/lib/inventoryType";

export type NamedCount = {
  name: string;
  count: number;
};

export type PartnerPurchaseCount = {
  id: string;
  name: string;
  count: number;
  revenue: number;
};

export type OrderTimePoint = {
  period: string;
  count: number;
};

export type NeonPurchaseAnalytics = {
  purchases: number;
  purchasesPlants: number;
  purchasesFlowers: number;
  purchasesCatalog: number;
  purchasesPartner: number;
  /** Partner orders with neither a sale-time inventory type nor a plant row. Counted as plants. */
  purchasesMissingCatalog: number;
  inventoryTypeFallback: "plants";
  revenue: number;
  revenueCatalog: number;
  revenuePartner: number;
  averageOrderValue: number;
  units: number;
  failedAttempts: number;
  expiredAttempts: number;
  needsReconciliation: number;
  topPlants: NamedCount[];
  /** Real partners only. Catalog is never a row. */
  byPartner: PartnerPurchaseCount[];
  /** Child locations of the selected partner. Empty in Urban Plant scope. */
  byLocation: NamedCount[];
  ordersOverTime: OrderTimePoint[];
};

type CountRow = {
  cnt: string | number;
  plants_cnt?: string | number;
  flowers_cnt?: string | number;
  catalog_cnt?: string | number;
  partner_cnt?: string | number;
  missing_catalog_cnt?: string | number;
  revenue?: string | number;
  catalog_revenue?: string | number;
  partner_revenue?: string | number;
  units?: string | number;
  failed_cnt?: string | number;
  expired_cnt?: string | number;
  recon_cnt?: string | number;
};
type NamedCountRow = { name: string | null; cnt: string | number };
type PartnerMetricRow = {
  id: string | null;
  name: string | null;
  cnt: string | number;
  revenue?: string | number;
};
type PeriodCountRow = { period: string | null; cnt: string | number };
type IdRow = { id: string };

function toCount(value: string | number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toMoney(value: string | number | null | undefined): number {
  const n = toCount(value);
  return Math.round(n * 100) / 100;
}

function asCountRows(rows: unknown): CountRow[] {
  return rows as CountRow[];
}

function asNamedCountRows(rows: unknown): NamedCountRow[] {
  return rows as NamedCountRow[];
}

function orderScope(
  startIso: string,
  endIso: string,
  typeParam: string | null,
  partnerId: string | null,
) {
  return sql`
    o.is_internal = false
    AND o.order_status IN ('sold', 'picked_up', 'delivered')
    AND o.created_at >= ${startIso}::timestamptz
    AND o.created_at < ${endIso}::timestamptz
    AND (
      ${typeParam}::text IS NULL
      OR (o.channel = 'catalog' AND ${typeParam}::text = 'plants')
      OR (
        o.channel = 'partner'
        AND COALESCE(
          NULLIF(btrim(o.snapshot->>'inventoryType'), ''),
          pl.inventory_type,
          'plants'
        ) = ${typeParam}::text
      )
    )
    AND (
      ${partnerId}::text IS NULL
      OR (o.channel = 'partner' AND o.partner_id = ${partnerId})
    )
  `;
}

function attemptScope(
  startIso: string,
  endIso: string,
  typeParam: string | null,
  partnerId: string | null,
) {
  return sql`
    a.is_internal = false
    AND a.created_at >= ${startIso}::timestamptz
    AND a.created_at < ${endIso}::timestamptz
    AND (
      ${typeParam}::text IS NULL
      OR (a.channel = 'catalog' AND ${typeParam}::text = 'plants')
      OR (
        a.channel = 'partner'
        AND COALESCE(
          NULLIF(btrim(a.snapshot->>'inventoryType'), ''),
          pl.inventory_type,
          'plants'
        ) = ${typeParam}::text
      )
    )
    AND (
      ${partnerId}::text IS NULL
      OR (
        a.channel = 'partner'
        AND EXISTS (
          SELECT 1
          FROM partner_locations loc
          WHERE loc.partner_id = ${partnerId}
            AND (
              loc.id::text = NULLIF(btrim(a.snapshot->>'partnerLocationId'), '')
              OR loc.id = (
                SELECT p.partner_location_id
                FROM pos_spots p
                WHERE p.id = a.pos_spot_id
              )
            )
        )
      )
    )
  `;
}

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
  /** Null is Urban Plant. A partner id excludes Catalog. */
  partnerId?: string | null;
};

export type AnalyticsLocationRef = {
  locationId: string;
  partnerId: string;
  partnerName: string;
  locationName: string;
};

export async function listAnalyticsLocations(): Promise<AnalyticsLocationRef[]> {
  const rows = (await sql`
    SELECT
      pl.id::text AS location_id,
      pl.partner_id,
      p.name AS partner_name,
      pl.name AS location_name
    FROM partner_locations pl
    INNER JOIN partners p ON p.id = pl.partner_id
  `) as {
    location_id: string;
    partner_id: string;
    partner_name: string;
    location_name: string;
  }[];
  return rows.map((row) => ({
    locationId: row.location_id,
    partnerId: row.partner_id,
    partnerName: row.partner_name,
    locationName: row.location_name,
  }));
}

/**
 * Verified successful orders (sold / picked_up / delivered) plus payment-attempt outcomes.
 * Bounds are [startInclusive, endExclusive). Internal rows are excluded.
 */
export async function getNeonPurchaseAnalytics(
  input: NeonPurchaseAnalyticsInput,
): Promise<NeonPurchaseAnalytics> {
  const startIso = input.startInclusive.toISOString();
  const endIso = input.endExclusive.toISOString();
  const typeParam = input.inventoryType === "all" ? null : input.inventoryType;
  const partnerId = input.partnerId?.trim() || null;
  const ordersWhere = orderScope(startIso, endIso, typeParam, partnerId);
  const attemptsWhere = attemptScope(startIso, endIso, typeParam, partnerId);

  const [totalRaw, unitsRaw, catalogTopRaw, partnerTopRaw, partnerRaw, locationRaw, ordersTimeRaw, attemptsRaw] =
    await Promise.all([
      sql`
        SELECT
          COUNT(*)::int AS cnt,
          COUNT(*) FILTER (WHERE o.channel = 'catalog')::int AS catalog_cnt,
          COUNT(*) FILTER (WHERE o.channel = 'partner')::int AS partner_cnt,
          COUNT(*) FILTER (
            WHERE o.channel = 'catalog'
              OR (
                o.channel = 'partner'
                AND COALESCE(
                  NULLIF(btrim(o.snapshot->>'inventoryType'), ''),
                  pl.inventory_type,
                  'plants'
                ) = 'plants'
              )
          )::int AS plants_cnt,
          COUNT(*) FILTER (
            WHERE o.channel = 'partner'
              AND COALESCE(
                NULLIF(btrim(o.snapshot->>'inventoryType'), ''),
                pl.inventory_type,
                'plants'
              ) = 'flowers'
          )::int AS flowers_cnt,
          COUNT(*) FILTER (
            WHERE o.channel = 'partner'
              AND NULLIF(btrim(o.snapshot->>'inventoryType'), '') IS NULL
              AND pl.id IS NULL
          )::int AS missing_catalog_cnt,
          COALESCE(SUM(o.price), 0)::float8 AS revenue,
          COALESCE(SUM(o.price) FILTER (WHERE o.channel = 'catalog'), 0)::float8 AS catalog_revenue,
          COALESCE(SUM(o.price) FILTER (WHERE o.channel = 'partner'), 0)::float8 AS partner_revenue
        FROM orders o
        LEFT JOIN plants pl ON pl.id = o.product_id
        WHERE ${ordersWhere}
      `,
      sql`
        SELECT (
          COALESCE((
            SELECT SUM(oi.quantity)::int
            FROM order_items oi
            INNER JOIN orders o ON o.order_id = oi.order_id
            LEFT JOIN plants pl ON pl.id = o.product_id
            WHERE ${ordersWhere}
              AND o.channel = 'catalog'
          ), 0)
          +
          COALESCE((
            SELECT COUNT(*)::int
            FROM orders o
            LEFT JOIN plants pl ON pl.id = o.product_id
            WHERE ${ordersWhere}
              AND o.channel = 'partner'
          ), 0)
        ) AS units
      `,
      sql`
        SELECT
          btrim(oi.plant_name) ||
            CASE
              WHEN NULLIF(btrim(oi.size_label), '') IS NOT NULL
              THEN ' · ' || btrim(oi.size_label)
              ELSE ''
            END AS name,
          SUM(oi.quantity)::int AS cnt
        FROM order_items oi
        INNER JOIN orders o ON o.order_id = oi.order_id
        LEFT JOIN plants pl ON pl.id = o.product_id
        WHERE ${ordersWhere}
          AND o.channel = 'catalog'
        GROUP BY 1
      `,
      sql`
        SELECT
          COALESCE(
            NULLIF(btrim(o.snapshot->>'productName'), ''),
            NULLIF(btrim(o.product_name), ''),
            'Unknown product'
          ) ||
            CASE
              WHEN NULLIF(btrim(o.snapshot->>'sizeLabel'), '') IS NOT NULL
              THEN ' · ' || btrim(o.snapshot->>'sizeLabel')
              ELSE ''
            END AS name,
          COUNT(*)::int AS cnt
        FROM orders o
        LEFT JOIN plants pl ON pl.id = o.product_id
        WHERE ${ordersWhere}
          AND o.channel = 'partner'
        GROUP BY 1
      `,
      sql`
        SELECT
          pr.id,
          pr.name,
          COUNT(*)::int AS cnt,
          COALESCE(SUM(o.price), 0)::float8 AS revenue
        FROM orders o
        INNER JOIN partners pr ON pr.id = o.partner_id
        LEFT JOIN plants pl ON pl.id = o.product_id
        WHERE ${ordersWhere}
          AND o.channel = 'partner'
        GROUP BY pr.id, pr.name
        ORDER BY cnt DESC, pr.name ASC
        LIMIT 20
      `,
      sql`
        SELECT
          COALESCE(
            NULLIF(btrim(o.partner_location_name), ''),
            NULLIF(btrim(o.snapshot->>'partnerLocationName'), ''),
            'Unknown location'
          ) AS name,
          COUNT(*)::int AS cnt
        FROM orders o
        LEFT JOIN plants pl ON pl.id = o.product_id
        WHERE ${ordersWhere}
          AND o.channel = 'partner'
          AND ${partnerId}::text IS NOT NULL
          AND o.partner_id = ${partnerId}
        GROUP BY 1
        ORDER BY cnt DESC, name ASC
        LIMIT 20
      `,
      sql`
        SELECT
          to_char(
            date_trunc('day', timezone('Asia/Jerusalem', o.created_at)),
            'YYYY-MM-DD'
          ) AS period,
          COUNT(*)::int AS cnt
        FROM orders o
        LEFT JOIN plants pl ON pl.id = o.product_id
        WHERE ${ordersWhere}
        GROUP BY 1
        ORDER BY 1 ASC
        LIMIT 400
      `,
      sql`
        SELECT
          COUNT(*) FILTER (WHERE a.status = 'failed')::int AS failed_cnt,
          COUNT(*) FILTER (WHERE a.status = 'expired')::int AS expired_cnt,
          COUNT(*) FILTER (WHERE a.status = 'needs_reconciliation')::int AS recon_cnt
        FROM payment_attempts a
        LEFT JOIN plants pl ON pl.id = a.product_id
        WHERE ${attemptsWhere}
      `,
    ]);

  const total = asCountRows(totalRaw)[0];
  const units = asCountRows(unitsRaw)[0];
  const attempts = asCountRows(attemptsRaw)[0];
  const purchases = toCount(total?.cnt);
  const revenue = toMoney(total?.revenue);
  const tops = new Map<string, number>();
  for (const row of [...asNamedCountRows(catalogTopRaw), ...asNamedCountRows(partnerTopRaw)]) {
    const name = (row.name ?? "").trim() || "Unknown product";
    tops.set(name, (tops.get(name) ?? 0) + toCount(row.cnt));
  }
  const topPlants = [...tops.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 20);

  return {
    purchases,
    purchasesPlants: toCount(total?.plants_cnt),
    purchasesFlowers: toCount(total?.flowers_cnt),
    purchasesCatalog: toCount(total?.catalog_cnt),
    purchasesPartner: toCount(total?.partner_cnt),
    purchasesMissingCatalog: toCount(total?.missing_catalog_cnt),
    inventoryTypeFallback: "plants",
    revenue,
    revenueCatalog: toMoney(total?.catalog_revenue),
    revenuePartner: toMoney(total?.partner_revenue),
    averageOrderValue: purchases > 0 ? Math.round((revenue / purchases) * 100) / 100 : 0,
    units: toCount(units?.units),
    failedAttempts: toCount(attempts?.failed_cnt),
    expiredAttempts: toCount(attempts?.expired_cnt),
    needsReconciliation: toCount(attempts?.recon_cnt),
    topPlants,
    byPartner: (partnerRaw as PartnerMetricRow[]).map((row) => ({
      id: (row.id ?? "").trim(),
      name: (row.name ?? "").trim() || "Unknown partner",
      count: toCount(row.cnt),
      revenue: toMoney(row.revenue),
    })),
    byLocation: asNamedCountRows(locationRaw).map((row) => ({
      name: (row.name ?? "").trim() || "Unknown location",
      count: toCount(row.cnt),
    })),
    ordersOverTime: (ordersTimeRaw as PeriodCountRow[]).map((row) => ({
      period: (row.period ?? "").trim(),
      count: toCount(row.cnt),
    })),
  };
}
