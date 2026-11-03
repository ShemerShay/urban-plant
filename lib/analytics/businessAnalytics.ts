import "server-only";

import type { AnalyticsFilterState, AnalyticsInventoryFilter } from "@/lib/analytics/analyticsQuery";
import {
  getNeonPurchaseAnalytics,
  listAnalyticsLocations,
  listPlantIdsByInventoryType,
  type NeonPurchaseAnalytics,
  type OrderTimePoint,
  type PartnerPurchaseCount,
} from "@/lib/analytics/neonPurchases";
import type { AnalyticsArea } from "@/lib/analytics/analyticsQuery";
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
  type PostHogQueryError,
  type PostHogQueryOutcome,
} from "@/lib/analytics/posthogQuery";

/** Outer load deadline so Analytics RSC always returns well before Netlify's 60s cap. */
export const ANALYTICS_LOAD_BUDGET_MS = 25_000;

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
  partnerId: string | null;
  area: AnalyticsArea;
  totalScans: number | null;
  uniqueScanners: number | null;
  checkoutStarted: number | null;
  paymentStarted: number | null;
  catalogCheckoutStarted: number | null;
  catalogPaymentStarted: number | null;
  purchases: number | null;
  purchasesPlants: number | null;
  purchasesFlowers: number | null;
  purchasesMissingCatalog: number | null;
  purchasesCatalog: number | null;
  purchasesPartner: number | null;
  revenue: number | null;
  revenueCatalog: number | null;
  revenuePartner: number | null;
  averageOrderValue: number | null;
  units: number | null;
  failedAttempts: number | null;
  expiredAttempts: number | null;
  needsReconciliation: number | null;
  catalogVisitors: number | null;
  catalogSessions: number | null;
  inventoryTypeFallback: "plants";
  /** Scan-level: pos_scan events with a later-or-equal purchase_completed in the same session and spot. */
  scanToCheckoutPercent: number | null;
  scansOverTime: AnalyticsTimePoint[];
  /** Set when the series HogQL query failed — not the same as zero scans. */
  scansOverTimeError: string | null;
  topPlantsByScans: AnalyticsNamedCount[];
  topPlantsByPurchases: AnalyticsNamedCount[];
  scansByPartner: AnalyticsNamedCount[];
  scansByLocation: AnalyticsNamedCount[];
  purchasesByPartner: PartnerPurchaseCount[];
  purchasesByLocation: AnalyticsNamedCount[];
  ordersOverTime: OrderTimePoint[];
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
  const zoned = `toTimeZone(timestamp, ${hogqlQuote(BUSINESS_TIME_ZONE)})`;
  switch (granularity) {
    case "hour":
      return `toStartOfHour(${zoned})`;
    case "day":
      return `toStartOfDay(${zoned})`;
    case "week":
      return `toStartOfWeek(${zoned}, 0)`;
  }
}

/**
 * inventory_type is authoritative when present.
 * plant_id catalog lookup applies only when inventory_type is missing.
 */
function hogqlLocationPredicate(locationIds: string[]): string {
  const ids = locationIds.map((id) => id.trim()).filter((id) => id !== "");
  if (ids.length === 0) return "1 = 0";
  return `toString(properties.partner_id) IN (${ids.map((id) => hogqlQuote(id)).join(", ")})`;
}

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
  | { ok: false; error: string; code: PostHogQueryError["code"] | "limit" };

type InternalIdsCacheStatus = "hit" | "miss" | "wait";

type InternalIdsLookup = InternalIdsOutcome & { cache: InternalIdsCacheStatus };

let internalIdsCache: { expiresAt: number; value: Extract<InternalIdsOutcome, { ok: true }> } | null =
  null;
let internalIdsInflight: Promise<InternalIdsOutcome> | null = null;

async function fetchInternalDistinctIds(signal?: AbortSignal): Promise<InternalIdsOutcome> {
  const sql = `
SELECT DISTINCT toString(distinct_id) AS id
FROM events
WHERE timestamp >= toDateTime('${INTERNAL_IDS_SINCE}')
  AND ifNull(toString(properties.is_internal), '') IN ('true', '1')
LIMIT ${INTERNAL_IDS_QUERY_LIMIT}
`.trim();
  const result = await runHogQLQuery(sql, "admin_analytics_internal_ids", { signal });
  if (!result.ok) {
    return { ok: false, error: result.error, code: result.code };
  }
  const ids = result.data.results
    .map((row) => hogqlRowString(row, 0).trim())
    .filter((id) => id !== "");
  if (ids.length >= INTERNAL_IDS_QUERY_LIMIT) {
    return {
      ok: false,
      error: `Internal distinct_id list hit limit ${INTERNAL_IDS_QUERY_LIMIT}`,
      code: "limit",
    };
  }
  return { ok: true, ids };
}

/**
 * Resolve internal distinct_ids once (short TTL) and reuse across HogQL scans.
 * Failures are not cached so a later request can recover.
 */
async function listInternalDistinctIds(signal?: AbortSignal): Promise<InternalIdsLookup> {
  const now = Date.now();
  if (internalIdsCache && internalIdsCache.expiresAt > now) {
    return { ...internalIdsCache.value, cache: "hit" };
  }
  if (internalIdsInflight) {
    const value = await internalIdsInflight;
    return { ...value, cache: "wait" };
  }
  const pending = fetchInternalDistinctIds(signal)
    .then((value) => {
      if (value.ok) {
        internalIdsCache = { expiresAt: Date.now() + INTERNAL_IDS_TTL_MS, value };
      }
      return value;
    })
    .finally(() => {
      internalIdsInflight = null;
    });
  internalIdsInflight = pending;
  const value = await pending;
  return { ...value, cache: "miss" };
}

function hogqlExcludeInternalDevices(internalDistinctIds: string[]): string {
  const quoted = internalDistinctIds
    .filter((id) => id.trim() !== "")
    .map((id) => hogqlQuote(id));
  if (quoted.length === 0) return "1 = 1";
  return `distinct_id NOT IN (${quoted.join(", ")})`;
}

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

type AnalyticsLogFields = Record<string, string | number | boolean | null>;

function logAnalyticsEvent(loadId: string, event: string, fields: AnalyticsLogFields = {}): void {
  console.info(`[admin-analytics] ${event}`, { loadId, ...fields });
}

function looksLikeTimeout(error: string): boolean {
  return /timeout|timed out|aborted/i.test(error);
}

function hogqlLogFields(outcome: PostHogQueryOutcome): AnalyticsLogFields {
  if (outcome.ok) return { ok: true, code: null, timeout: false };
  return { ok: false, code: outcome.code, timeout: outcome.code === "timeout" };
}

async function withDuration<T>(work: Promise<T>): Promise<{ value: T; ms: number }> {
  const started = Date.now();
  const value = await work;
  return { value, ms: Date.now() - started };
}

function neonMetrics(
  data: NeonPurchaseAnalytics | null,
): Pick<
  BusinessAnalyticsSnapshot,
  | "purchases"
  | "purchasesPlants"
  | "purchasesFlowers"
  | "purchasesMissingCatalog"
  | "purchasesCatalog"
  | "purchasesPartner"
  | "revenue"
  | "revenueCatalog"
  | "revenuePartner"
  | "averageOrderValue"
  | "units"
  | "failedAttempts"
  | "expiredAttempts"
  | "needsReconciliation"
  | "topPlantsByPurchases"
  | "purchasesByPartner"
  | "purchasesByLocation"
  | "ordersOverTime"
> {
  if (!data) {
    return {
      purchases: null,
      purchasesPlants: null,
      purchasesFlowers: null,
      purchasesMissingCatalog: null,
      purchasesCatalog: null,
      purchasesPartner: null,
      revenue: null,
      revenueCatalog: null,
      revenuePartner: null,
      averageOrderValue: null,
      units: null,
      failedAttempts: null,
      expiredAttempts: null,
      needsReconciliation: null,
      topPlantsByPurchases: [],
      purchasesByPartner: [],
      purchasesByLocation: [],
      ordersOverTime: [],
    };
  }
  return {
    purchases: data.purchases,
    purchasesPlants: data.purchasesPlants,
    purchasesFlowers: data.purchasesFlowers,
    purchasesMissingCatalog: data.purchasesMissingCatalog,
    purchasesCatalog: data.purchasesCatalog,
    purchasesPartner: data.purchasesPartner,
    revenue: data.revenue,
    revenueCatalog: data.revenueCatalog,
    revenuePartner: data.revenuePartner,
    averageOrderValue: data.averageOrderValue,
    units: data.units,
    failedAttempts: data.failedAttempts,
    expiredAttempts: data.expiredAttempts,
    needsReconciliation: data.needsReconciliation,
    topPlantsByPurchases: data.topPlants,
    purchasesByPartner: data.byPartner,
    purchasesByLocation: data.byLocation,
    ordersOverTime: data.ordersOverTime,
  };
}

function emptySnapshot(
  filters: AnalyticsFilterState,
  timeGranularity: TimeGranularity,
  errors: { posthogError: string | null; neonError: string | null },
): BusinessAnalyticsSnapshot {
  return {
    inventoryType: filters.inventoryType,
    dateFilter: filters.dateFilter,
    partnerId: filters.partnerId,
    area: filters.area,
    totalScans: null,
    uniqueScanners: null,
    checkoutStarted: null,
    paymentStarted: null,
    catalogCheckoutStarted: null,
    catalogPaymentStarted: null,
    purchases: null,
    purchasesPlants: null,
    purchasesFlowers: null,
    purchasesMissingCatalog: null,
    purchasesCatalog: null,
    purchasesPartner: null,
    revenue: null,
    revenueCatalog: null,
    revenuePartner: null,
    averageOrderValue: null,
    units: null,
    failedAttempts: null,
    expiredAttempts: null,
    needsReconciliation: null,
    catalogVisitors: null,
    catalogSessions: null,
    inventoryTypeFallback: "plants",
    scanToCheckoutPercent: null,
    scansOverTime: [],
    scansOverTimeError: errors.posthogError,
    topPlantsByScans: [],
    topPlantsByPurchases: [],
    scansByPartner: [],
    scansByLocation: [],
    purchasesByPartner: [],
    purchasesByLocation: [],
    ordersOverTime: [],
    scansByPocket: [],
    posthogError: errors.posthogError,
    neonError: errors.neonError,
    timeGranularity,
  };
}

/**
 * Load admin business analytics for inventory type + resolved date bounds.
 * Neon purchase aggregates always run. PostHog HogQL runs only for areas that
 * consume it (Overall KPI; Logistics suite), in one parallel wave after setup.
 */
export async function loadBusinessAnalytics(
  filters: AnalyticsFilterState,
): Promise<BusinessAnalyticsSnapshot> {
  const loadId = crypto.randomUUID();
  const started = Date.now();
  logAnalyticsEvent(loadId, "load_start");
  const bounds = resolveDateFilterBounds(filters.dateFilter);
  const granularity = timeGranularityForCalendarRange(bounds.from, bounds.to);
  const loadAbort = new AbortController();
  let budgetExceeded = false;
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  const budgetFallback = emptySnapshot(filters, granularity, {
    posthogError: `Analytics load timed out after ${ANALYTICS_LOAD_BUDGET_MS / 1000}s`,
    neonError: null,
  });
  const budget = new Promise<BusinessAnalyticsSnapshot>((resolve) => {
    budgetTimer = setTimeout(() => {
      budgetExceeded = true;
      if (!loadAbort.signal.aborted) loadAbort.abort();
      resolve(budgetFallback);
    }, ANALYTICS_LOAD_BUDGET_MS);
  });
  try {
    const inner = loadBusinessAnalyticsInner(
      filters,
      bounds,
      granularity,
      loadId,
      loadAbort.signal,
    ).then((snapshot) => {
      if (budgetTimer !== undefined) {
        clearTimeout(budgetTimer);
        budgetTimer = undefined;
      }
      return snapshot;
    });
    const snapshot = await Promise.race([inner, budget]);
    logAnalyticsEvent(loadId, "load_finish", {
      ms: Date.now() - started,
      thrown: false,
      budgetExceeded,
      posthogFailed: snapshot.posthogError != null,
      neonFailed: snapshot.neonError != null,
    });
    return snapshot;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analytics load failed";
    if (!loadAbort.signal.aborted) loadAbort.abort();
    logAnalyticsEvent(loadId, "load_finish", {
      ms: Date.now() - started,
      thrown: true,
      budgetExceeded,
      errorName: err instanceof Error ? err.name : "unknown",
      timeout: looksLikeTimeout(message),
    });
    return emptySnapshot(filters, granularity, {
      posthogError: message,
      neonError: message,
    });
  } finally {
    if (budgetTimer !== undefined) clearTimeout(budgetTimer);
  }
}

async function loadBusinessAnalyticsInner(
  filters: AnalyticsFilterState,
  bounds: ReturnType<typeof resolveDateFilterBounds>,
  granularity: TimeGranularity,
  loadId: string,
  signal: AbortSignal,
): Promise<BusinessAnalyticsSnapshot> {
  const timeFilter = `timestamp >= ${hogqlDateTime(bounds.startInclusive)} AND timestamp < ${hogqlDateTime(bounds.endExclusive)}`;
  const bucketExpr = hogqlTimeBucketExpr(granularity);
  const scan = ANALYTICS_EVENTS.posScan;
  const purchase = ANALYTICS_EVENTS.purchaseCompleted;

  const neonPromise = getNeonPurchaseAnalytics({
    startInclusive: bounds.startInclusive,
    endExclusive: bounds.endExclusive,
    inventoryType: filters.inventoryType,
    partnerId: filters.partnerId,
  })
    .then((data) => ({ ok: true as const, data }))
    .catch((err: unknown) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : "Neon purchase query failed",
    }));

  logAnalyticsEvent(loadId, "op_start", { op: "neon" });
  const neonP = withDuration(neonPromise).then((timed) => {
    logAnalyticsEvent(loadId, "op", {
      op: "neon",
      ms: timed.ms,
      ok: timed.value.ok,
      timeout: timed.value.ok ? false : looksLikeTimeout(timed.value.error),
      code: timed.value.ok ? null : "neon_failed",
    });
    return timed;
  });

  // Financial UI is Neon-only — skip PostHog setup and HogQL entirely.
  if (filters.area === "financial") {
    const neonTimed = await neonP;
    const neonResult = neonTimed.value;
    const neonError = neonResult.ok ? null : neonResult.error;
    const neonFields = neonMetrics(neonResult.ok ? neonResult.data : null);
    return {
      ...emptySnapshot(filters, granularity, {
        posthogError: null,
        neonError,
      }),
      ...neonFields,
    };
  }

  const plantIdsPromise =
    filters.inventoryType === "all"
      ? Promise.resolve({ ok: true as const, ids: [] as string[] })
      : listPlantIdsByInventoryType(filters.inventoryType)
          .then((ids) => ({ ok: true as const, ids }))
          .catch((err: unknown) => ({
            ok: false as const,
            error: err instanceof Error ? err.message : "Catalog lookup failed",
          }));

  const locationsPromise = listAnalyticsLocations()
    .then((rows) => ({ ok: true as const, rows }))
    .catch((err: unknown) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : "Partner directory failed",
    }));

  logAnalyticsEvent(loadId, "op_start", { op: "internal_ids" });
  const internalP = withDuration(listInternalDistinctIds(signal)).then((timed) => {
    logAnalyticsEvent(loadId, "op", {
      op: "internal_ids",
      ms: timed.ms,
      ok: timed.value.ok,
      cache: timed.value.cache,
      timeout: timed.value.ok ? false : timed.value.code === "timeout",
      code: timed.value.ok ? null : timed.value.code,
    });
    return timed;
  });
  const [internalTimed, plantIdsResult, neonTimed, locationsResult] = await Promise.all([
    internalP,
    plantIdsPromise,
    neonP,
    locationsPromise,
  ]);
  const internalIdsResult = internalTimed.value;
  const neonResult = neonTimed.value;

  const neonError = neonResult.ok ? null : neonResult.error;
  const neonFields = neonMetrics(neonResult.ok ? neonResult.data : null);

  if (!internalIdsResult.ok) {
    return {
      ...emptySnapshot(filters, granularity, {
        posthogError: internalIdsResult.error,
        neonError,
      }),
      ...neonFields,
    };
  }

  if (!plantIdsResult.ok) {
    return {
      ...emptySnapshot(filters, granularity, {
        posthogError: plantIdsResult.error,
        neonError,
      }),
      ...neonFields,
    };
  }

  const inventoryPredicate =
    filters.inventoryType === "all"
      ? "1 = 1"
      : hogqlInventoryPredicate(filters.inventoryType, plantIdsResult.ids);
  const customerScope = posthogCustomerScope(internalIdsResult.ids);
  const partnerLocations = locationsResult.ok
    ? locationsResult.rows.filter((row) => row.partnerId === filters.partnerId)
    : [];
  const locationPredicate = filters.partnerId
    ? hogqlLocationPredicate(locationsResult.ok ? partnerLocations.map((row) => row.locationId) : [])
    : "1 = 1";
  const locationById = new Map(
    (locationsResult.ok ? locationsResult.rows : []).map((row) => [row.locationId, row]),
  );

  /** Overall consumes KPI conversion only; Logistics consumes the full PostHog suite. */
  const needKpis = true;
  const needSeries = filters.area === "logistics";
  const needBreakdowns = filters.area === "logistics";
  const needFunnel = filters.area === "logistics";
  const needVisitors =
    filters.area === "logistics" &&
    filters.inventoryType !== "flowers" &&
    filters.partnerId == null;
  const needCatalogFunnel = filters.area === "logistics" && filters.partnerId == null;

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
    AND ${locationPredicate}
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
  AND ${locationPredicate}
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
  toString(properties.partner_id) AS location_id,
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
  AND ${locationPredicate}
  AND event = '${scan}'
GROUP BY plant_name, location_id, pocket_name
LIMIT 5000
`.trim();

  const visitorsSql = `
SELECT
  uniqIf(
    distinct_id,
    position(toString(properties.$current_url), '/shop') > 0
  ) AS catalog_visitors,
  uniqIf(
    $session_id,
    position(toString(properties.$current_url), '/shop') > 0
  ) AS catalog_sessions
FROM events
WHERE ${timeFilter}
  AND ${customerScope}
  AND event = '$pageview'
`.trim();

  const checkout = ANALYTICS_EVENTS.checkoutStarted;
  const payment = ANALYTICS_EVENTS.paymentStarted;
  const funnelSql = `
SELECT
  countIf(event = '${checkout}' AND toString(properties.channel) != 'catalog') AS checkouts,
  countIf(event = '${payment}' AND toString(properties.channel) != 'catalog') AS payments
FROM events
WHERE ${timeFilter}
  AND ${customerScope}
  AND ${inventoryPredicate}
  AND ${locationPredicate}
  AND event IN ('${checkout}', '${payment}')
  AND toString(properties.channel) != 'catalog'
`.trim();
  const catalogFunnelSql = `
SELECT
  countIf(event = '${checkout}' AND toString(properties.channel) = 'catalog') AS checkouts,
  countIf(event = '${payment}' AND toString(properties.channel) = 'catalog') AS payments
FROM events
WHERE ${timeFilter}
  AND ${customerScope}
  AND event IN ('${checkout}', '${payment}')
  AND toString(properties.channel) = 'catalog'
`.trim();

  const emptyHogqlOk: PostHogQueryOutcome = {
    ok: true,
    data: { columns: [], results: [] },
  };

  if (needKpis) logAnalyticsEvent(loadId, "op_start", { op: "kpis" });
  if (needSeries) logAnalyticsEvent(loadId, "op_start", { op: "series" });
  if (needBreakdowns) logAnalyticsEvent(loadId, "op_start", { op: "breakdowns" });
  if (needVisitors) logAnalyticsEvent(loadId, "op_start", { op: "visitors" });
  if (needFunnel) logAnalyticsEvent(loadId, "op_start", { op: "funnel" });
  if (needCatalogFunnel) logAnalyticsEvent(loadId, "op_start", { op: "catalog_funnel" });

  // Single PostHog wave: run only area-needed queries concurrently (no B→C gate).
  const kpisP = needKpis
    ? withDuration(runHogQLQuery(kpisSql, `admin_analytics_kpis`, { signal })).then((timed) => {
        logAnalyticsEvent(loadId, "op", {
          op: "kpis",
          ms: timed.ms,
          ...hogqlLogFields(timed.value),
        });
        return timed.value;
      })
    : Promise.resolve(emptyHogqlOk);
  const seriesP = needSeries
    ? withDuration(runHogQLQuery(seriesSql, `admin_analytics_series`, { signal })).then((timed) => {
        logAnalyticsEvent(loadId, "op", {
          op: "series",
          ms: timed.ms,
          ...hogqlLogFields(timed.value),
        });
        return timed.value;
      })
    : Promise.resolve(emptyHogqlOk);
  const breakdownsP = needBreakdowns
    ? withDuration(runHogQLQuery(breakdownsSql, `admin_analytics_breakdowns`, { signal })).then(
        (timed) => {
          logAnalyticsEvent(loadId, "op", {
            op: "breakdowns",
            ms: timed.ms,
            ...hogqlLogFields(timed.value),
          });
          return timed.value;
        },
      )
    : Promise.resolve(emptyHogqlOk);
  const visitorsP = needVisitors
    ? withDuration(runHogQLQuery(visitorsSql, "admin_analytics_visitors", { signal })).then(
        (timed) => {
          logAnalyticsEvent(loadId, "op", {
            op: "visitors",
            ms: timed.ms,
            ...hogqlLogFields(timed.value),
          });
          return timed.value;
        },
      )
    : Promise.resolve(null);
  const funnelP = needFunnel
    ? withDuration(runHogQLQuery(funnelSql, "admin_analytics_funnel", { signal })).then((timed) => {
        logAnalyticsEvent(loadId, "op", {
          op: "funnel",
          ms: timed.ms,
          ...hogqlLogFields(timed.value),
        });
        return timed.value;
      })
    : Promise.resolve(emptyHogqlOk);
  const catalogFunnelP = needCatalogFunnel
    ? withDuration(
        runHogQLQuery(catalogFunnelSql, "admin_analytics_catalog_funnel", { signal }),
      ).then((timed) => {
        logAnalyticsEvent(loadId, "op", {
          op: "catalog_funnel",
          ms: timed.ms,
          ...hogqlLogFields(timed.value),
        });
        return timed.value;
      })
    : Promise.resolve(null);

  const [kpis, series, breakdowns, visitors, funnel, catalogFunnel] = await Promise.all([
    kpisP,
    seriesP,
    breakdownsP,
    visitorsP,
    funnelP,
    catalogFunnelP,
  ]);
  const posthogErrors = [kpis, series, breakdowns, ...(visitors ? [visitors] : [])]
    .filter((r): r is Extract<PostHogQueryOutcome, { ok: false }> => !r.ok)
    .map((r) => r.error);

  let catalogVisitors: number | null = null;
  let catalogSessions: number | null = null;
  if (visitors?.ok && visitors.data.results[0]) {
    const row = visitors.data.results[0];
    catalogVisitors = hogqlRowNumber(row, 0);
    catalogSessions = hogqlRowNumber(row, 1);
  }

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
  const scansOverTimeError = series.ok ? null : series.error;

  const plantBuckets = new Map<string, number>();
  const partnerBuckets = new Map<string, number>();
  const locationBuckets = new Map<string, number>();
  const pocketBuckets = new Map<string, number>();
  if (breakdowns.ok) {
    for (const row of breakdowns.data.results) {
      const plantName = displayName(hogqlRowString(row, 0), "(Unknown)");
      const locationId = hogqlRowString(row, 1).trim();
      const pocketName = displayName(hogqlRowString(row, 2), "(Unknown)");
      const scans = hogqlRowNumber(row, 3);
      const location = locationById.get(locationId);
      const partnerName = location?.partnerName?.trim() || "(Unknown partner)";
      const locationName = location?.locationName?.trim() || "(Unknown location)";
      plantBuckets.set(plantName, (plantBuckets.get(plantName) ?? 0) + scans);
      partnerBuckets.set(partnerName, (partnerBuckets.get(partnerName) ?? 0) + scans);
      locationBuckets.set(locationName, (locationBuckets.get(locationName) ?? 0) + scans);
      pocketBuckets.set(pocketName, (pocketBuckets.get(pocketName) ?? 0) + scans);
    }
  }

  const posthogError =
    [
      ...posthogErrors,
      ...(!funnel.ok ? [funnel.error] : []),
      ...(catalogFunnel && !catalogFunnel.ok ? [catalogFunnel.error] : []),
      ...(!locationsResult.ok ? [locationsResult.error] : []),
    ]
      .filter((error, index, all) => error && all.indexOf(error) === index)
      .join(" · ") || null;
  const checkoutStarted = funnel.ok && funnel.data.results[0] ? hogqlRowNumber(funnel.data.results[0], 0) : null;
  const paymentStarted = funnel.ok && funnel.data.results[0] ? hogqlRowNumber(funnel.data.results[0], 1) : null;
  const catalogCheckoutStarted =
    catalogFunnel?.ok && catalogFunnel.data.results[0]
      ? hogqlRowNumber(catalogFunnel.data.results[0], 0)
      : filters.partnerId
        ? null
        : null;
  const catalogPaymentStarted =
    catalogFunnel?.ok && catalogFunnel.data.results[0]
      ? hogqlRowNumber(catalogFunnel.data.results[0], 1)
      : null;

  return {
    inventoryType: filters.inventoryType,
    dateFilter: filters.dateFilter,
    partnerId: filters.partnerId,
    area: filters.area,
    totalScans,
    uniqueScanners,
    checkoutStarted,
    paymentStarted,
    catalogCheckoutStarted,
    catalogPaymentStarted,
    ...neonFields,
    catalogVisitors,
    catalogSessions,
    inventoryTypeFallback: "plants",
    scanToCheckoutPercent,
    scansOverTime,
    scansOverTimeError,
    topPlantsByScans: topNamedCounts(plantBuckets, 20),
    scansByPartner: filters.partnerId ? [] : topNamedCounts(partnerBuckets, 20),
    scansByLocation: filters.partnerId ? topNamedCounts(locationBuckets, 20) : [],
    scansByPocket: topNamedCounts(pocketBuckets, 20),
    posthogError,
    neonError,
    timeGranularity: granularity,
  };
}
