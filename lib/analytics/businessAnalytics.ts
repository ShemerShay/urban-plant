import "server-only";

import { ANALYTICS_EVENTS } from "@/lib/analyticsEvents";
import {
  neonCreatedAtFrom,
  posthogTimeBucketExpr,
  posthogTimestampPredicate,
  type AnalyticsRangeKey,
} from "@/lib/analytics/dateRange";
import { getNeonPurchaseAnalytics } from "@/lib/analytics/neonPurchases";
import {
  hogqlRowNumber,
  hogqlRowString,
  runHogQLQuery,
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
  range: AnalyticsRangeKey;
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
  timeGranularity: "hour" | "day" | "week";
};

function displayName(raw: string, fallback: string): string {
  const t = raw.trim();
  return t || fallback;
}

/**
 * Drop staff browsers from customer analytics: any distinct_id that has ever
 * sent `is_internal` (including historical events from that same anonymous ID).
 * Window matches the "all time" analytics bound so a recent tag still excludes
 * older scans when the dashboard range is shorter.
 */
const POSTHOG_EXCLUDE_INTERNAL_DEVICES = `
distinct_id NOT IN (
  SELECT DISTINCT distinct_id
  FROM events
  WHERE timestamp >= toDateTime('2020-01-01 00:00:00')
    AND ifNull(toString(properties.is_internal), '') IN ('true', '1')
)
`.trim();

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

const POSTHOG_CUSTOMER_SCOPE = `
${POSTHOG_EXCLUDE_INTERNAL_DEVICES}
AND ${POSTHOG_INCLUDE_PARTNERS}
AND ${POSTHOG_EXCLUDE_TEST}
AND ${POSTHOG_EXCLUDE_LOCALHOST}
`.trim();

/**
 * Load admin business analytics for a date range.
 * Three parallel PostHog HogQL queries + one Neon purchase aggregate.
 */
export async function loadBusinessAnalytics(
  range: AnalyticsRangeKey,
): Promise<BusinessAnalyticsSnapshot> {
  const timeFilter = posthogTimestampPredicate(range);
  const bucket = posthogTimeBucketExpr(range);
  const scan = ANALYTICS_EVENTS.posScan;
  const purchase = ANALYTICS_EVENTS.purchaseCompleted;

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
    AND ${POSTHOG_CUSTOMER_SCOPE}
    AND event IN ('${scan}', '${purchase}')
)
WHERE event = '${scan}'
`.trim();

  const seriesSql = `
SELECT
  ${bucket.expr} AS period,
  count() AS scans
FROM events
WHERE ${timeFilter}
  AND ${POSTHOG_CUSTOMER_SCOPE}
  AND event = '${scan}'
GROUP BY period
ORDER BY period ASC
LIMIT 200
`.trim();

  const breakdownsSql = `
SELECT dim, name, scans FROM (
  SELECT
    'plant' AS dim,
    if(
      empty(trim(toString(properties.plant_name))),
      '(Missing plant_name)',
      trim(toString(properties.plant_name))
    ) AS name,
    count() AS scans
  FROM events
  WHERE ${timeFilter}
    AND ${POSTHOG_CUSTOMER_SCOPE}
    AND event = '${scan}'
  GROUP BY name

  UNION ALL

  SELECT
    'partner' AS dim,
    if(
      empty(trim(toString(properties.partner_name))),
      '(Missing partner_name)',
      trim(toString(properties.partner_name))
    ) AS name,
    count() AS scans
  FROM events
  WHERE ${timeFilter}
    AND ${POSTHOG_CUSTOMER_SCOPE}
    AND event = '${scan}'
  GROUP BY name

  UNION ALL

  SELECT
    'pocket' AS dim,
    if(
      empty(trim(toString(properties.pocket_name))),
      '(Missing pocket_name)',
      trim(toString(properties.pocket_name))
    ) AS name,
    count() AS scans
  FROM events
  WHERE ${timeFilter}
    AND ${POSTHOG_CUSTOMER_SCOPE}
    AND event = '${scan}'
  GROUP BY name
)
ORDER BY dim ASC, scans DESC
LIMIT 100
`.trim();

  const neonFrom = neonCreatedAtFrom(range);

  const [kpis, series, breakdowns, neonResult] = await Promise.all([
    runHogQLQuery(kpisSql, `admin_analytics_kpis_${range}`),
    runHogQLQuery(seriesSql, `admin_analytics_series_${range}`),
    runHogQLQuery(breakdownsSql, `admin_analytics_breakdowns_${range}`),
    getNeonPurchaseAnalytics(neonFrom)
      .then((data) => ({ ok: true as const, data }))
      .catch((err: unknown) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : "Neon purchase query failed",
      })),
  ]);

  const posthogErrors = [kpis, series, breakdowns]
    .filter((r) => !r.ok)
    .map((r) => (!r.ok ? r.error : ""));
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

  const topPlantsByScans: AnalyticsNamedCount[] = [];
  const scansByPartner: AnalyticsNamedCount[] = [];
  const scansByPocket: AnalyticsNamedCount[] = [];
  if (breakdowns.ok) {
    for (const row of breakdowns.data.results) {
      const dim = hogqlRowString(row, 0);
      const entry = {
        name: displayName(hogqlRowString(row, 1), "(Unknown)"),
        count: hogqlRowNumber(row, 2),
      };
      if (dim === "plant" && topPlantsByScans.length < 20) topPlantsByScans.push(entry);
      else if (dim === "partner" && scansByPartner.length < 20) scansByPartner.push(entry);
      else if (dim === "pocket" && scansByPocket.length < 20) scansByPocket.push(entry);
    }
  }

  return {
    range,
    totalScans,
    uniqueScanners,
    purchases: neonResult.ok ? neonResult.data.purchases : null,
    purchasesPlants: neonResult.ok ? neonResult.data.purchasesPlants : null,
    purchasesFlowers: neonResult.ok ? neonResult.data.purchasesFlowers : null,
    purchasesMissingCatalog: neonResult.ok
      ? neonResult.data.purchasesMissingCatalog
      : null,
    inventoryTypeFallback: "plants",
    scanToCheckoutPercent,
    scansOverTime,
    topPlantsByScans,
    topPlantsByPurchases: neonResult.ok ? neonResult.data.topPlants : [],
    scansByPartner,
    purchasesByPartner: neonResult.ok ? neonResult.data.byPartner : [],
    scansByPocket,
    posthogError,
    neonError: neonResult.ok ? null : neonResult.error,
    timeGranularity: bucket.granularity,
  };
}
