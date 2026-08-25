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
  /** Person-based: distinct_ids with checkout_started among those with pos_scan. */
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
 * Load admin business analytics for a date range.
 * Three parallel PostHog HogQL queries + one Neon purchase aggregate.
 */
export async function loadBusinessAnalytics(
  range: AnalyticsRangeKey,
): Promise<BusinessAnalyticsSnapshot> {
  const timeFilter = posthogTimestampPredicate(range);
  const bucket = posthogTimeBucketExpr(range);
  const scan = ANALYTICS_EVENTS.posScan;
  const checkout = ANALYTICS_EVENTS.checkoutStarted;

  // One pass over people: total scan events, unique scanners, scan→checkout converters.
  const kpisSql = `
SELECT
  sum(scan_count) AS total_scans,
  countIf(scan_count > 0) AS unique_scanners,
  countIf(scan_count > 0 AND checkout_count > 0) AS converted
FROM (
  SELECT
    distinct_id,
    countIf(event = '${scan}') AS scan_count,
    countIf(event = '${checkout}') AS checkout_count
  FROM events
  WHERE ${timeFilter}
    AND event IN ('${scan}', '${checkout}')
  GROUP BY distinct_id
)
`.trim();

  const seriesSql = `
SELECT
  ${bucket.expr} AS period,
  count() AS scans
FROM events
WHERE ${timeFilter}
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
      uniqueScanners > 0
        ? Math.round((converted / uniqueScanners) * 1000) / 10
        : 0;
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
