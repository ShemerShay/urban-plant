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

function emptySnapshot(
  filters: AnalyticsFilterState,
  timeGranularity: TimeGranularity,
  errors: { posthogError: string | null; neonError: string | null },
): BusinessAnalyticsSnapshot {
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

  logAnalyticsEvent(loadId, "op_start", { op: "internal_ids" });
  logAnalyticsEvent(loadId, "op_start", { op: "neon" });
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
  const [internalTimed, plantIdsResult, neonTimed] = await Promise.all([
    internalP,
    plantIdsPromise,
    neonP,
  ]);
  const internalIdsResult = internalTimed.value;
  const neonResult = neonTimed.value;

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

  logAnalyticsEvent(loadId, "op_start", { op: "kpis" });
  logAnalyticsEvent(loadId, "op_start", { op: "series" });
  logAnalyticsEvent(loadId, "op_start", { op: "breakdowns" });
  const kpisP = withDuration(
    runHogQLQuery(kpisSql, `admin_analytics_kpis`, { signal }),
  ).then((timed) => {
    logAnalyticsEvent(loadId, "op", {
      op: "kpis",
      ms: timed.ms,
      ...hogqlLogFields(timed.value),
    });
    return timed;
  });
  const seriesP = withDuration(
    runHogQLQuery(seriesSql, `admin_analytics_series`, { signal }),
  ).then((timed) => {
    logAnalyticsEvent(loadId, "op", {
      op: "series",
      ms: timed.ms,
      ...hogqlLogFields(timed.value),
    });
    return timed;
  });
  const breakdownsP = withDuration(
    runHogQLQuery(breakdownsSql, `admin_analytics_breakdowns`, { signal }),
  ).then((timed) => {
    logAnalyticsEvent(loadId, "op", {
      op: "breakdowns",
      ms: timed.ms,
      ...hogqlLogFields(timed.value),
    });
    return timed;
  });
  const [kpisTimed, seriesTimed, breakdownsTimed] = await Promise.all([
    kpisP,
    seriesP,
    breakdownsP,
  ]);
  const kpis = kpisTimed.value;
  const series = seriesTimed.value;
  const breakdowns = breakdownsTimed.value;

  const posthogErrors = [kpis, series, breakdowns]
    .filter((r): r is Extract<PostHogQueryOutcome, { ok: false }> => !r.ok)
    .map((r) => r.error);
  const posthogError =
    posthogErrors.length > 0 ? [...new Set(posthogErrors)].join(" · ") : null;

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
