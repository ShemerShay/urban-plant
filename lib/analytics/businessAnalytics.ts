import "server-only";

import type { AnalyticsFilterState, AnalyticsInventoryFilter } from "@/lib/analytics/analyticsQuery";
import {
  getNeonPurchaseAnalytics,
  listPlantIdsByInventoryType,
} from "@/lib/analytics/neonPurchases";
import { ANALYTICS_EVENTS } from "@/lib/analyticsEvents";
import {
  BUSINESS_TIME_ZONE,
  resolveDateFilterBounds,
  timeGranularityForCalendarRange,
  type DateFilterValue,
  type TimeGranularity,
} from "@/lib/dateFilter";
import type { InventoryType } from "@/lib/inventoryType";
import {
  hogqlRowNumber,
  hogqlRowString,
  runHogQLQuery,
  type PostHogQueryOutcome,
} from "@/lib/analytics/posthogQuery";

export type AnalyticsNamedCount = {
  name: string;
  count: number;
};

export type AnalyticsTimePoint = {
  /** ISO-ish label from PostHog */
  period: string;
  scans: number;
};

export type BusinessAnalyticsSnapshot = {
  inventoryType: AnalyticsInventoryFilter;
  dateFilter: DateFilterValue;
  totalScans: number | null;
  uniqueScanners: number | null;
  purchases: number | null;
  purchasesPlants: number | null;
  purchasesFlowers: number | null;
  purchasesMissingCatalog: number | null;
  inventoryTypeFallback: "plants";
  /** Scan-level: pos_scan events with a later-or-equal purchase_completed in the same session and spot. */
  scanToCheckoutPercent: number | null;
  scansOverTime: AnalyticsTimePoint[];
  topPlantsByScans: AnalyticsNamedCount[];
  topPlantsByPurchases: AnalyticsNamedCount[];
  scansByPartner: AnalyticsNamedCount[];
  purchasesByPartner: AnalyticsNamedCount[];
  scansByPocket: AnalyticsNamedCount[];
  posthogError: string | null;
  neonError: string | null;
  timeGranularity: TimeGranularity;
};

function displayName(raw: string, fallback: string): string {
  const t = raw.trim();
  return t || fallback;
}

function hogqlDateTime(instant: Date): string {
  return `toDateTime('${instant.toISOString().slice(0, 19).replace("T", " ")}')`;
}

function hogqlQuote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function hogqlTimeBucketExpr(granularity: TimeGranularity): string {
  const tz = hogqlQuote(BUSINESS_TIME_ZONE);
  switch (granularity) {
    case "hour":
      return `toStartOfHour(timestamp, ${tz})`;
    case "day":
      return `toStartOfDay(timestamp, ${tz})`;
    case "week":
      return `toStartOfWeek(timestamp, 0, ${tz})`;
  }
}

/**
 * inventory_type is authoritative when present.
 * plant_id catalog lookup applies only when inventory_type is missing.
 */
function hogqlInventoryPredicate(
  inventoryType: InventoryType,
  plantIds: string[],
): string {
  const typeLit = hogqlQuote(inventoryType);
  const idList = plantIds.filter((id) => id.trim() !== "").map((id) => hogqlQuote(id));
  const plantFallback =
    idList.length > 0 ? `toString(properties.plant_id) IN (${idList.join(", ")})` : "1 = 0";
  return `(
  toString(properties.inventory_type) = ${typeLit}
  OR (
    ifNull(nullIf(toString(properties.inventory_type), ''), '') = ''
    AND ${plantFallback}
  )
)`.trim();
}

/**
 * Drop staff browsers from customer analytics: any distinct_id that has ever
 * sent `is_internal` (including historical events from that same anonymous ID).
 * Window matches a fixed lower bound so a recent tag still excludes
 * older scans when the dashboard range is shorter.
 */
const INTERNAL_IDS_SINCE = "2020-01-01 00:00:00";
const INTERNAL_IDS_TTL_MS = 60_000;
const INTERNAL_IDS_QUERY_LIMIT = 5000;

type InternalIdsOutcome =
  | { ok: true; ids: string[] }
  | { ok: false; error: string };

let internalIdsCache: { expiresAt: number; value: Extract<InternalIdsOutcome, { ok: true }> } | null =
  null;
let internalIdsInflight: Promise<InternalIdsOutcome> | null = null;

async function fetchInternalDistinctIds(): Promise<InternalIdsOutcome> {
  const sql = `
SELECT DISTINCT toString(distinct_id) AS id
FROM events
WHERE timestamp >= toDateTime('${INTERNAL_IDS_SINCE}')
  AND ifNull(toString(properties.is_internal), '') IN ('true', '1')
LIMIT ${INTERNAL_IDS_QUERY_LIMIT}
`.trim();
  const result = await runHogQLQuery(sql, "admin_analytics_internal_ids");
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const ids = result.data.results
    .map((row) => hogqlRowString(row, 0).trim())
    .filter((id) => id !== "");
  if (ids.length >= INTERNAL_IDS_QUERY_LIMIT) {
    return {
      ok: false,
      error: `Internal distinct_id list hit limit ${INTERNAL_IDS_QUERY_LIMIT}`,
    };
  }
  return { ok: true, ids };
}

/**
 * Resolve internal distinct_ids once (short TTL) and reuse across HogQL scans.
 * Failures are not cached so a later request can recover.
 */
async function listInternalDistinctIds(): Promise<InternalIdsOutcome> {
  const now = Date.now();
  if (internalIdsCache && internalIdsCache.expiresAt > now) {
    return internalIdsCache.value;
  }
  if (internalIdsInflight) return internalIdsInflight;
  internalIdsInflight = fetchInternalDistinctIds()
    .then((value) => {
      if (value.ok) {
        internalIdsCache = { expiresAt: Date.now() + INTERNAL_IDS_TTL_MS, value };
      }
      return value;
    })
    .finally(() => {
      internalIdsInflight = null;
    });
  return internalIdsInflight;
}

function hogqlExcludeInternalDevices(internalDistinctIds: string[]): string {
  const quoted = internalDistinctIds
    .filter((id) => id.trim() !== "")
    .map((id) => hogqlQuote(id));
  if (quoted.length === 0) return "1 = 1";
  return `distinct_id NOT IN (${quoted.join(", ")})`;
}

/** Add partner IDs / name needles here to widen the dashboard without rewriting queries. */
const ANALYTICS_PARTNER_NAME_NEEDLE = "alon shabo";
const ANALYTICS_PARTNER_IDS = [
  "0d11277b-9b47-45a5-ad80-22cf5c1ad2ef",
  "ef33137e-fe13-4be3-84bb-1f5b80557815",
] as const;

const POSTHOG_INCLUDE_PARTNERS = `
(
  position(lower(toString(properties.partner_name)), '${ANALYTICS_PARTNER_NAME_NEEDLE}') > 0
  OR toString(properties.partner_id) IN (${ANALYTICS_PARTNER_IDS.map((id) => `'${id}'`).join(", ")})
)
`.trim();

const POSTHOG_EXCLUDE_TEST = `
position(lower(concat(
  toString(properties.partner_name), ' ',
  toString(properties.plant_name), ' ',
  toString(properties.spot_slug), ' ',
  toString(properties.pocket_name)
)), 'test') = 0
`.trim();

const POSTHOG_EXCLUDE_LOCALHOST = `
position(lower(toString(properties.$host)), 'localhost') = 0
`.trim();

/** Accidental internal incognito scan from 2026-08-31 (personless; could not delete in PostHog). */
const POSTHOG_EXCLUDE_ACCIDENTAL_DISTINCT_IDS = [
  "01a057e8-4ec9-78c1-b9a8-b9dfa4c6ffd7",
] as const;

const POSTHOG_EXCLUDE_ACCIDENTAL_SCANS = `
toString(distinct_id) NOT IN (${POSTHOG_EXCLUDE_ACCIDENTAL_DISTINCT_IDS.map((id) => `'${id}'`).join(", ")})
`.trim();

function posthogCustomerScope(internalDistinctIds: string[]): string {
  return `
${hogqlExcludeInternalDevices(internalDistinctIds)}
AND ${POSTHOG_INCLUDE_PARTNERS}
AND ${POSTHOG_EXCLUDE_TEST}
AND ${POSTHOG_EXCLUDE_LOCALHOST}
AND ${POSTHOG_EXCLUDE_ACCIDENTAL_SCANS}
`.trim();
}

function topNamedCounts(
  buckets: Map<string, number>,
  limit: number,
): AnalyticsNamedCount[] {
  return [...buckets.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function logAnalyticsError(source: string, error: string | null): void {
  if (!error) return;
  console.error(`[admin-analytics] ${source}: ${error}`);
}

function emptySnapshot(
  filters: AnalyticsFilterState,
  timeGranularity: TimeGranularity,
  errors: { posthogError: string | null; neonError: string | null },
): BusinessAnalyticsSnapshot {
  logAnalyticsError("posthog", errors.posthogError);
  logAnalyticsError("neon", errors.neonError);
  return {
    inventoryType: filters.inventoryType,
    dateFilter: filters.dateFilter,
    totalScans: null,
    uniqueScanners: null,
    purchases: null,
    purchasesPlants: null,
    purchasesFlowers: null,
    purchasesMissingCatalog: null,
    inventoryTypeFallback: "plants",
    scanToCheckoutPercent: null,
    scansOverTime: [],
    topPlantsByScans: [],
    topPlantsByPurchases: [],
    scansByPartner: [],
    purchasesByPartner: [],
    scansByPocket: [],
    posthogError: errors.posthogError,
    neonError: errors.neonError,
    timeGranularity,
  };
}

/**
 * Load admin business analytics for inventory type + resolved date bounds.
 * Internal distinct_ids are resolved once, then three parallel PostHog HogQL
 * queries plus Neon purchase aggregates.
 */
export async function loadBusinessAnalytics(
  filters: AnalyticsFilterState,
): Promise<BusinessAnalyticsSnapshot> {
  const bounds = resolveDateFilterBounds(filters.dateFilter);
  const granularity = timeGranularityForCalendarRange(bounds.from, bounds.to);
  try {
    return await loadBusinessAnalyticsInner(filters, bounds, granularity);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analytics load failed";
    return emptySnapshot(filters, granularity, {
      posthogError: message,
      neonError: message,
    });
  }
}

async function loadBusinessAnalyticsInner(
  filters: AnalyticsFilterState,
  bounds: ReturnType<typeof resolveDateFilterBounds>,
  granularity: TimeGranularity,
): Promise<BusinessAnalyticsSnapshot> {
  const timeFilter = `timestamp >= ${hogqlDateTime(bounds.startInclusive)} AND timestamp < ${hogqlDateTime(bounds.endExclusive)}`;
  const bucketExpr = hogqlTimeBucketExpr(granularity);
  const scan = ANALYTICS_EVENTS.posScan;
  const purchase = ANALYTICS_EVENTS.purchaseCompleted;

  const plantIdsPromise =
    filters.inventoryType === "all"
      ? Promise.resolve({ ok: true as const, ids: [] as string[] })
      : listPlantIdsByInventoryType(filters.inventoryType)
          .then((ids) => ({ ok: true as const, ids }))
          .catch((err: unknown) => ({
            ok: false as const,
            error: err instanceof Error ? err.message : "Catalog lookup failed",
          }));

  const neonPromise = getNeonPurchaseAnalytics({
    startInclusive: bounds.startInclusive,
    endExclusive: bounds.endExclusive,
    inventoryType: filters.inventoryType,
  })
    .then((data) => ({ ok: true as const, data }))
    .catch((err: unknown) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : "Neon purchase query failed",
    }));

  const [internalIdsResult, plantIdsResult, neonResult] = await Promise.all([
    listInternalDistinctIds(),
    plantIdsPromise,
    neonPromise,
  ]);

  const neonError = neonResult.ok ? null : neonResult.error;
  const purchases = neonResult.ok ? neonResult.data.purchases : null;
  const purchasesPlants = neonResult.ok ? neonResult.data.purchasesPlants : null;
  const purchasesFlowers = neonResult.ok ? neonResult.data.purchasesFlowers : null;
  const purchasesMissingCatalog = neonResult.ok
    ? neonResult.data.purchasesMissingCatalog
    : null;
  const topPlantsByPurchases = neonResult.ok ? neonResult.data.topPlants : [];
  const purchasesByPartner = neonResult.ok ? neonResult.data.byPartner : [];

  if (!internalIdsResult.ok) {
    return {
      ...emptySnapshot(filters, granularity, {
        posthogError: internalIdsResult.error,
        neonError,
      }),
      purchases,
      purchasesPlants,
      purchasesFlowers,
      purchasesMissingCatalog,
      topPlantsByPurchases,
      purchasesByPartner,
    };
  }

  if (!plantIdsResult.ok) {
    return {
      ...emptySnapshot(filters, granularity, {
        posthogError: plantIdsResult.error,
        neonError,
      }),
      purchases,
      purchasesPlants,
      purchasesFlowers,
      purchasesMissingCatalog,
      topPlantsByPurchases,
      purchasesByPartner,
    };
  }

  const inventoryPredicate =
    filters.inventoryType === "all"
      ? "1 = 1"
      : hogqlInventoryPredicate(filters.inventoryType, plantIdsResult.ids);
  const customerScope = posthogCustomerScope(internalIdsResult.ids);

  // Scan-level: a pos_scan converts if a purchase_completed exists in the same
  // $session_id + pos_spot_id with timestamp >= the scan.
  const kpisSql = `
SELECT
  count() AS total_scans,
  uniq(distinct_id) AS unique_scanners,
  countIf(max_purchase_ts >= timestamp) AS converted
FROM (
  SELECT
    event,
    distinct_id,
    timestamp,
    maxIf(timestamp, event = '${purchase}') OVER (
      PARTITION BY $session_id, toString(properties.pos_spot_id)
    ) AS max_purchase_ts
  FROM events
  WHERE ${timeFilter}
    AND ${customerScope}
    AND ${inventoryPredicate}
    AND event IN ('${scan}', '${purchase}')
)
WHERE event = '${scan}'
`.trim();

  const seriesSql = `
SELECT
  ${bucketExpr} AS period,
  count() AS scans
FROM events
WHERE ${timeFilter}
  AND ${customerScope}
  AND ${inventoryPredicate}
  AND event = '${scan}'
GROUP BY period
ORDER BY period ASC
LIMIT 200
`.trim();

  const breakdownsSql = `
SELECT
  if(
    empty(trim(toString(properties.plant_name))),
    '(Missing plant_name)',
    trim(toString(properties.plant_name))
  ) AS plant_name,
  if(
    empty(trim(toString(properties.partner_name))),
    '(Missing partner_name)',
    trim(toString(properties.partner_name))
  ) AS partner_name,
  if(
    empty(trim(toString(properties.pocket_name))),
    '(Missing pocket_name)',
    trim(toString(properties.pocket_name))
  ) AS pocket_name,
  count() AS scans
FROM events
WHERE ${timeFilter}
  AND ${customerScope}
  AND ${inventoryPredicate}
  AND event = '${scan}'
GROUP BY plant_name, partner_name, pocket_name
LIMIT 5000
`.trim();

  const [kpis, series, breakdowns] = await Promise.all([
    runHogQLQuery(kpisSql, `admin_analytics_kpis`),
    runHogQLQuery(seriesSql, `admin_analytics_series`),
    runHogQLQuery(breakdownsSql, `admin_analytics_breakdowns`),
  ]);

  const posthogErrors = [kpis, series, breakdowns]
    .filter((r): r is Extract<PostHogQueryOutcome, { ok: false }> => !r.ok)
    .map((r) => r.error);
  const posthogError =
    posthogErrors.length > 0 ? [...new Set(posthogErrors)].join(" · ") : null;
  logAnalyticsError("posthog", posthogError);
  logAnalyticsError("neon", neonError);

  let totalScans: number | null = null;
  let uniqueScanners: number | null = null;
  let scanToCheckoutPercent: number | null = null;
  if (kpis.ok && kpis.data.results[0]) {
    const row = kpis.data.results[0];
    totalScans = hogqlRowNumber(row, 0);
    uniqueScanners = hogqlRowNumber(row, 1);
    const converted = hogqlRowNumber(row, 2);
    scanToCheckoutPercent =
      totalScans > 0 ? Math.round((converted / totalScans) * 1000) / 10 : 0;
  }

  const scansOverTime: AnalyticsTimePoint[] = series.ok
    ? series.data.results.map((row) => ({
        period: hogqlRowString(row, 0),
        scans: hogqlRowNumber(row, 1),
      }))
    : [];

  const plantBuckets = new Map<string, number>();
  const partnerBuckets = new Map<string, number>();
  const pocketBuckets = new Map<string, number>();
  if (breakdowns.ok) {
    for (const row of breakdowns.data.results) {
      const plantName = displayName(hogqlRowString(row, 0), "(Unknown)");
      const partnerName = displayName(hogqlRowString(row, 1), "(Unknown)");
      const pocketName = displayName(hogqlRowString(row, 2), "(Unknown)");
      const scans = hogqlRowNumber(row, 3);
      plantBuckets.set(plantName, (plantBuckets.get(plantName) ?? 0) + scans);
      partnerBuckets.set(partnerName, (partnerBuckets.get(partnerName) ?? 0) + scans);
      pocketBuckets.set(pocketName, (pocketBuckets.get(pocketName) ?? 0) + scans);
    }
  }

  return {
    inventoryType: filters.inventoryType,
    dateFilter: filters.dateFilter,
    totalScans,
    uniqueScanners,
    purchases,
    purchasesPlants,
    purchasesFlowers,
    purchasesMissingCatalog,
    inventoryTypeFallback: "plants",
    scanToCheckoutPercent,
    scansOverTime,
    topPlantsByScans: topNamedCounts(plantBuckets, 20),
    topPlantsByPurchases,
    scansByPartner: topNamedCounts(partnerBuckets, 20),
    purchasesByPartner,
    scansByPocket: topNamedCounts(pocketBuckets, 20),
    posthogError,
    neonError,
    timeGranularity: granularity,
  };
}
