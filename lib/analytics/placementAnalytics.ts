/**
 * Backend historical Placement / Pocket / POS analytics.
 *
 * Source of truth split:
 * - Neon `placement_cycles` + `placement_segments` + `orders`: immutable placement,
 *   pocket, offer, price, supplier-cost, and sale/revenue/commission snapshots.
 * - PostHog `pos_scan`: behavioral scan events joined to the active Segment at event
 *   timestamp (never copied into Neon).
 * - Legacy Neon `events` table is intentionally excluded from this analytics path.
 *
 * Reliability note:
 *   History prior to cycle tracking (038) and snapshot/cost tracking (060) is incomplete.
 *   Unknown historical values remain `null` and are reported via `reliability` counts.
 */

import "server-only";

import { ANALYTICS_EVENTS } from "@/lib/analyticsEvents";
import {
  hogqlDateTime,
  hogqlQuote,
  listInternalDistinctIds,
  posthogCustomerScope,
} from "@/lib/analytics/businessAnalytics";
import { hogqlRowString, runHogQLQuery } from "@/lib/analytics/posthogQuery";
import { sql } from "@/lib/db";
import type { CycleEndReason, PlacementKind } from "@/lib/placementCycle";

export type PlacementAnalyticsFilter = {
  /** Include cycles overlapping `[startInclusive, endExclusive)`. */
  startInclusive?: Date;
  endExclusive?: Date;
  partnerId?: string | null;
  partnerLocationId?: string | null;
  plantId?: string | null;
  /** Reference instant for open cycle/segment durations (default: `new Date()`). */
  asOf?: Date;
  /** Query live PostHog `pos_scan` events and join to active segments (default: `true`). */
  includeScans?: boolean;
  signal?: AbortSignal;
};

export type PlacementScanEvent = {
  posSpotId: string;
  distinctId: string;
  timestampMs: number;
};

export type PlacementSegmentAnalytics = {
  segmentId: string;
  cycleId: string;
  posSpotId: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  pocketId: string | null;
  pocketName: string | null;
  offerId: string;
  consumerPrice: number;
  sellableVariantId: string | null;
  potId: string | null;
  potName: string | null;
  plantUnitCost: number | null;
  plantUnitCostSource: string | null;
  potUnitCost: number | null;
  potUnitCostSource: string | null;
  totalSupplierUnitCost: number | null;
  scans: number | null;
  uniqueScanners: number | null;
};

export type PlacementCycleAnalytics = {
  cycleId: string;
  posSpotId: string;
  plantVariantId: string;
  partnerId: string | null;
  partnerName: string | null;
  partnerLocationId: string | null;
  partnerLocationName: string | null;
  plantId: string | null;
  plantName: string | null;
  sizeLabel: string | null;
  placementKind: PlacementKind | null;
  startedAt: string;
  endedAt: string | null;
  endReason: CycleEndReason | null;
  isActive: boolean;
  durationMs: number;
  orderId: string | null;
  soldAt: string | null;
  timeToSaleMs: number | null;
  saleRevenue: number | null;
  commissionRate: number | null;
  commissionAmount: number | null;
  saleSupplierUnitCost: number | null;
  scans: number | null;
  uniqueScanners: number | null;
  segments: PlacementSegmentAnalytics[];
};

export type PlacementGroupPerformance = {
  key: string;
  label: string;
  placements: number;
  active: number;
  sold: number;
  removed: number;
  replaced: number;
  deactivated: number;
  initialPlacements: number;
  restockPlacements: number;
  avgDurationMs: number | null;
  avgTimeToSaleMs: number | null;
  scans: number | null;
  sales: number;
  revenue: number;
  commissionAmount: number;
};

export type PocketPerformanceRow = {
  partnerLocationId: string | null;
  pocketId: string | null;
  pocketName: string;
  segments: number;
  totalDurationMs: number;
  avgDurationMs: number | null;
  scans: number | null;
  sales: number;
  revenue: number;
};

export type VariantConfigPerformanceRow = {
  sellableVariantId: string | null;
  plantId: string | null;
  plantName: string;
  sizeLabel: string | null;
  potId: string | null;
  potName: string | null;
  segments: number;
  totalDurationMs: number;
  scans: number | null;
  sales: number;
  revenue: number;
};

export type PlacementAnalyticsSummary = {
  totalPlacements: number;
  activePlacements: number;
  soldPlacements: number;
  removedPlacements: number;
  replacedPlacements: number;
  deactivatedPlacements: number;
  initialPlacements: number;
  restockPlacements: number;
  unknownKindPlacements: number;
  avgDurationMs: number | null;
  avgTimeToSaleMs: number | null;
  totalScans: number | null;
  uniqueScanners: number | null;
  totalSales: number;
  totalRevenue: number;
  totalCommissionAmount: number;
  scanToSalePercent: number | null;
};

export type PlacementAnalyticsReliability = {
  preSnapshotTrackingIncomplete: true;
  legacyCyclesWithoutKind: number;
  legacyCyclesWithoutPartnerSnapshot: number;
  segmentsWithoutCostSnapshot: number;
  unattributedScans: number | null;
  truncatedPosthogScans: boolean;
};

export type PlacementAnalyticsReport = {
  summary: PlacementAnalyticsSummary;
  byPartner: PlacementGroupPerformance[];
  byLocation: PlacementGroupPerformance[];
  byPocket: PocketPerformanceRow[];
  byPlant: PlacementGroupPerformance[];
  byPlantSize: PlacementGroupPerformance[];
  bySellableVariant: VariantConfigPerformanceRow[];
  byPot: VariantConfigPerformanceRow[];
  placements: PlacementCycleAnalytics[];
  reliability: PlacementAnalyticsReliability;
  posthogError: string | null;
};

type RawCycleRow = {
  cycle_id: string;
  pos_spot_id: string;
  plant_variant_id: string;
  partner_id: string | null;
  partner_name: string | null;
  partner_location_id: string | null;
  partner_location_name: string | null;
  plant_id: string | null;
  plant_name: string | null;
  size_label: string | null;
  placement_kind: string | null;
  started_at: string | Date;
  ended_at: string | Date | null;
  end_reason: string | null;
  order_id: string | null;
  order_created_at: string | Date | null;
  order_price: string | number | null;
  order_commission_rate: string | number | null;
  order_supplier_unit_cost: string | number | null;
};

type RawSegmentRow = {
  segment_id: string;
  placement_cycle_id: string;
  pos_spot_id: string;
  started_at: string | Date;
  ended_at: string | Date | null;
  pocket_id: string | null;
  pocket_name: string | null;
  offer_id: string;
  consumer_price: string | number;
  sellable_variant_id: string | null;
  pot_id: string | null;
  pot_name: string | null;
  plant_unit_cost: string | number | null;
  plant_unit_cost_source: string | null;
  pot_unit_cost: string | number | null;
  pot_unit_cost_source: string | null;
  total_supplier_unit_cost: string | number | null;
};

const POSTHOG_SCAN_QUERY_LIMIT = 10_000;

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNullableIso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  return toIso(value);
}

function toNullableNum(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function asPlacementKind(value: string | null): PlacementKind | null {
  return value === "initial" || value === "restock" ? value : null;
}

function asEndReason(value: string | null): CycleEndReason | null {
  if (
    value === "sold" ||
    value === "removed" ||
    value === "replaced" ||
    value === "deactivated"
  ) {
    return value;
  }
  return null;
}

function avgOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((acc, v) => acc + v, 0) / values.length);
}

/**
 * Attribute PostHog `pos_scan` events to the unique Segment active on that
 * `pos_spot_id` at the event timestamp: `[started_at, coalesce(ended_at, asOf))`.
 */
export function attributeScansToSegments(
  segments: ReadonlyArray<{
    segmentId: string;
    cycleId: string;
    posSpotId: string;
    startedAtMs: number;
    endedAtMs: number | null;
  }>,
  scans: ReadonlyArray<PlacementScanEvent>,
): {
  segmentScans: Map<string, { scans: number; distinctIds: Set<string> }>;
  cycleScans: Map<string, { scans: number; distinctIds: Set<string> }>;
  totalMatchedScans: number;
  uniqueMatchedScanners: Set<string>;
  unattributedScans: number;
} {
  const bySpot = new Map<
    string,
    Array<{
      segmentId: string;
      cycleId: string;
      startedAtMs: number;
      endedAtMs: number | null;
    }>
  >();
  for (const seg of segments) {
    const list = bySpot.get(seg.posSpotId) ?? [];
    list.push({
      segmentId: seg.segmentId,
      cycleId: seg.cycleId,
      startedAtMs: seg.startedAtMs,
      endedAtMs: seg.endedAtMs,
    });
    bySpot.set(seg.posSpotId, list);
  }
  for (const list of bySpot.values()) {
    list.sort((a, b) => a.startedAtMs - b.startedAtMs);
  }

  const segmentScans = new Map<string, { scans: number; distinctIds: Set<string> }>();
  const cycleScans = new Map<string, { scans: number; distinctIds: Set<string> }>();
  const uniqueMatchedScanners = new Set<string>();
  let totalMatchedScans = 0;
  let unattributedScans = 0;

  for (const scan of scans) {
    const candidates = bySpot.get(scan.posSpotId);
    if (!candidates || candidates.length === 0) {
      unattributedScans += 1;
      continue;
    }
    const matched = candidates.find(
      (seg) =>
        scan.timestampMs >= seg.startedAtMs &&
        (seg.endedAtMs === null || scan.timestampMs < seg.endedAtMs),
    );
    if (!matched) {
      unattributedScans += 1;
      continue;
    }
    totalMatchedScans += 1;
    if (scan.distinctId) uniqueMatchedScanners.add(scan.distinctId);

    const segEntry = segmentScans.get(matched.segmentId) ?? {
      scans: 0,
      distinctIds: new Set<string>(),
    };
    segEntry.scans += 1;
    if (scan.distinctId) segEntry.distinctIds.add(scan.distinctId);
    segmentScans.set(matched.segmentId, segEntry);

    const cycEntry = cycleScans.get(matched.cycleId) ?? {
      scans: 0,
      distinctIds: new Set<string>(),
    };
    cycEntry.scans += 1;
    if (scan.distinctId) cycEntry.distinctIds.add(scan.distinctId);
    cycleScans.set(matched.cycleId, cycEntry);
  }

  return {
    segmentScans,
    cycleScans,
    totalMatchedScans,
    uniqueMatchedScanners,
    unattributedScans,
  };
}

function buildGroupPerformance(
  placements: PlacementCycleAnalytics[],
  keyFn: (c: PlacementCycleAnalytics) => { key: string; label: string },
  scansKnown: boolean,
): PlacementGroupPerformance[] {
  const groups = new Map<
    string,
    {
      label: string;
      durations: number[];
      tts: number[];
      row: PlacementGroupPerformance;
    }
  >();

  for (const c of placements) {
    const { key, label } = keyFn(c);
    const entry = groups.get(key) ?? {
      label,
      durations: [],
      tts: [],
      row: {
        key,
        label,
        placements: 0,
        active: 0,
        sold: 0,
        removed: 0,
        replaced: 0,
        deactivated: 0,
        initialPlacements: 0,
        restockPlacements: 0,
        avgDurationMs: null,
        avgTimeToSaleMs: null,
        scans: scansKnown ? 0 : null,
        sales: 0,
        revenue: 0,
        commissionAmount: 0,
      },
    };
    const r = entry.row;
    r.placements += 1;
    if (c.isActive) r.active += 1;
    if (c.endReason === "sold") r.sold += 1;
    if (c.endReason === "removed") r.removed += 1;
    if (c.endReason === "replaced") r.replaced += 1;
    if (c.endReason === "deactivated") r.deactivated += 1;
    if (c.placementKind === "initial") r.initialPlacements += 1;
    if (c.placementKind === "restock") r.restockPlacements += 1;
    entry.durations.push(c.durationMs);
    if (c.timeToSaleMs != null) entry.tts.push(c.timeToSaleMs);
    if (scansKnown && c.scans != null) {
      r.scans = (r.scans ?? 0) + c.scans;
    }
    if (c.endReason === "sold" && c.saleRevenue != null) {
      r.sales += 1;
      r.revenue = roundMoney(r.revenue + c.saleRevenue);
      if (c.commissionAmount != null) {
        r.commissionAmount = roundMoney(r.commissionAmount + c.commissionAmount);
      }
    }
    groups.set(key, entry);
  }

  return [...groups.values()]
    .map((g) => ({
      ...g.row,
      avgDurationMs: avgOrNull(g.durations),
      avgTimeToSaleMs: avgOrNull(g.tts),
    }))
    .sort((a, b) => b.placements - a.placements || a.label.localeCompare(b.label));
}

export async function loadPlacementAnalytics(
  filter: PlacementAnalyticsFilter = {},
): Promise<PlacementAnalyticsReport> {
  const asOf = filter.asOf ?? new Date();
  const asOfMs = asOf.getTime();
  const partnerId = filter.partnerId?.trim() || null;
  const partnerLocationId = filter.partnerLocationId?.trim() || null;
  const plantId = filter.plantId?.trim() || null;
  const startIso = filter.startInclusive ? filter.startInclusive.toISOString() : null;
  const endIso = filter.endExclusive ? filter.endExclusive.toISOString() : null;

  const rawCycles = (await sql`
    SELECT
      c.id::text AS cycle_id,
      c.pos_spot_id::text AS pos_spot_id,
      c.plant_variant_id::text AS plant_variant_id,
      c.partner_id,
      c.partner_name,
      c.partner_location_id,
      c.partner_location_name,
      c.plant_id,
      c.plant_name,
      c.size_label,
      c.placement_kind,
      c.started_at,
      c.ended_at,
      c.end_reason,
      c.order_id::text AS order_id,
      o.created_at AS order_created_at,
      o.price AS order_price,
      o.commission_rate AS order_commission_rate,
      o.supplier_unit_cost AS order_supplier_unit_cost
    FROM placement_cycles c
    LEFT JOIN orders o
      ON o.order_id = c.order_id
     AND o.is_internal = false
     AND o.order_status IN ('sold', 'picked_up', 'delivered')
    WHERE (${partnerId}::text IS NULL OR c.partner_id = ${partnerId})
      AND (${partnerLocationId}::text IS NULL OR c.partner_location_id = ${partnerLocationId})
      AND (${plantId}::text IS NULL OR c.plant_id = ${plantId})
      AND (${endIso}::timestamptz IS NULL OR c.started_at < ${endIso}::timestamptz)
      AND (
        ${startIso}::timestamptz IS NULL
        OR c.ended_at IS NULL
        OR c.ended_at >= ${startIso}::timestamptz
      )
    ORDER BY c.started_at ASC, c.id ASC
  `) as RawCycleRow[];

  const cycleIds = rawCycles.map((r) => r.cycle_id);
  const rawSegments =
    cycleIds.length === 0
      ? []
      : ((await sql`
          SELECT
            s.id::text AS segment_id,
            s.placement_cycle_id::text AS placement_cycle_id,
            c.pos_spot_id::text AS pos_spot_id,
            s.started_at,
            s.ended_at,
            s.pocket_id::text AS pocket_id,
            s.pocket_name,
            s.offer_id,
            s.consumer_price,
            s.sellable_variant_id::text AS sellable_variant_id,
            s.pot_id::text AS pot_id,
            s.pot_name,
            s.plant_unit_cost,
            s.plant_unit_cost_source,
            s.pot_unit_cost,
            s.pot_unit_cost_source,
            s.total_supplier_unit_cost
          FROM placement_segments s
          INNER JOIN placement_cycles c ON c.id = s.placement_cycle_id
          WHERE s.placement_cycle_id = ANY(${cycleIds}::uuid[])
          ORDER BY s.started_at ASC, s.id ASC
        `) as RawSegmentRow[]);

  const segmentTiming = rawSegments.map((s) => {
    const startedAtMs = new Date(s.started_at).getTime();
    const endedAtMs = s.ended_at ? new Date(s.ended_at).getTime() : null;
    return {
      segmentId: s.segment_id,
      cycleId: s.placement_cycle_id,
      posSpotId: s.pos_spot_id,
      startedAtMs,
      endedAtMs,
    };
  });

  let posthogError: string | null = null;
  let scansKnown = false;
  let scanAttribution: ReturnType<typeof attributeScansToSegments> | null = null;
  let truncatedPosthogScans = false;

  const shouldQueryPosthog = filter.includeScans !== false && segmentTiming.length > 0;
  if (shouldQueryPosthog) {
    const internalResult = await listInternalDistinctIds(filter.signal);
    if (!internalResult.ok) {
      posthogError = internalResult.error;
    } else {
      const minStartMs = Math.min(...segmentTiming.map((s) => s.startedAtMs));
      const maxEndMs = segmentTiming.some((s) => s.endedAtMs === null)
        ? asOfMs
        : Math.max(...segmentTiming.map((s) => s.endedAtMs ?? asOfMs));
      const queryStart = new Date(
        filter.startInclusive
          ? Math.max(minStartMs, filter.startInclusive.getTime())
          : minStartMs,
      );
      const queryEnd = new Date(
        filter.endExclusive
          ? Math.min(Math.max(maxEndMs, queryStart.getTime() + 1000), filter.endExclusive.getTime())
          : Math.max(maxEndMs, queryStart.getTime() + 1000),
      );
      const spotIds = [...new Set(segmentTiming.map((s) => s.posSpotId))];
      const spotPredicate = `toString(properties.pos_spot_id) IN (${spotIds.map((id) => hogqlQuote(id)).join(", ")})`;
      const customerScope = posthogCustomerScope(internalResult.ids);

      const hogql = `
SELECT
  toString(properties.pos_spot_id) AS pos_spot_id,
  toString(distinct_id) AS distinct_id,
  timestamp
FROM events
WHERE timestamp >= ${hogqlDateTime(queryStart)}
  AND timestamp < ${hogqlDateTime(queryEnd)}
  AND ${customerScope}
  AND event = ${hogqlQuote(ANALYTICS_EVENTS.posScan)}
  AND ${spotPredicate}
ORDER BY timestamp ASC
LIMIT ${POSTHOG_SCAN_QUERY_LIMIT}
`.trim();

      const res = await runHogQLQuery(hogql, "placement_analytics_pos_scans", {
        signal: filter.signal,
      });
      if (!res.ok) {
        posthogError = res.error;
      } else {
        scansKnown = true;
        truncatedPosthogScans = res.data.results.length >= POSTHOG_SCAN_QUERY_LIMIT;
        const events: PlacementScanEvent[] = [];
        for (const row of res.data.results) {
          const posSpotId = hogqlRowString(row, 0).trim();
          const distinctId = hogqlRowString(row, 1).trim();
          const tsRaw = hogqlRowString(row, 2).trim();
          const timestampMs = Date.parse(tsRaw);
          if (!posSpotId || !Number.isFinite(timestampMs)) continue;
          events.push({ posSpotId, distinctId, timestampMs });
        }
        scanAttribution = attributeScansToSegments(segmentTiming, events);
      }
    }
  } else if (filter.includeScans !== false && rawCycles.length === 0) {
    scansKnown = true;
    scanAttribution = attributeScansToSegments([], []);
  }

  const segmentsByCycle = new Map<string, PlacementSegmentAnalytics[]>();
  let segmentsWithoutCostSnapshot = 0;

  for (const raw of rawSegments) {
    const startMs = new Date(raw.started_at).getTime();
    const endMs = raw.ended_at ? new Date(raw.ended_at).getTime() : asOfMs;
    const durationMs = Math.max(0, endMs - startMs);
    const plantUnitCost = toNullableNum(raw.plant_unit_cost);
    const potUnitCost = toNullableNum(raw.pot_unit_cost);
    const totalSupplierUnitCost = toNullableNum(raw.total_supplier_unit_cost);
    if (totalSupplierUnitCost === null) {
      segmentsWithoutCostSnapshot += 1;
    }
    const segScanBucket = scanAttribution?.segmentScans.get(raw.segment_id);
    const seg: PlacementSegmentAnalytics = {
      segmentId: raw.segment_id,
      cycleId: raw.placement_cycle_id,
      posSpotId: raw.pos_spot_id,
      startedAt: toIso(raw.started_at),
      endedAt: toNullableIso(raw.ended_at),
      durationMs,
      pocketId: raw.pocket_id,
      pocketName: raw.pocket_name,
      offerId: raw.offer_id,
      consumerPrice: toNullableNum(raw.consumer_price) ?? 0,
      sellableVariantId: raw.sellable_variant_id,
      potId: raw.pot_id,
      potName: raw.pot_name,
      plantUnitCost,
      plantUnitCostSource: raw.plant_unit_cost_source,
      potUnitCost,
      potUnitCostSource: raw.pot_unit_cost_source,
      totalSupplierUnitCost,
      scans: scansKnown ? (segScanBucket?.scans ?? 0) : null,
      uniqueScanners: scansKnown ? (segScanBucket?.distinctIds.size ?? 0) : null,
    };
    const arr = segmentsByCycle.get(raw.placement_cycle_id) ?? [];
    arr.push(seg);
    segmentsByCycle.set(raw.placement_cycle_id, arr);
  }

  let legacyCyclesWithoutKind = 0;
  let legacyCyclesWithoutPartnerSnapshot = 0;

  const placements: PlacementCycleAnalytics[] = rawCycles.map((raw) => {
    const startMs = new Date(raw.started_at).getTime();
    const endMs = raw.ended_at ? new Date(raw.ended_at).getTime() : asOfMs;
    const durationMs = Math.max(0, endMs - startMs);
    const endReason = asEndReason(raw.end_reason);
    const placementKind = asPlacementKind(raw.placement_kind);
    if (!placementKind) legacyCyclesWithoutKind += 1;
    if (!raw.partner_id || !raw.partner_location_id) {
      legacyCyclesWithoutPartnerSnapshot += 1;
    }

    const saleRevenue = toNullableNum(raw.order_price);
    const commissionRate = toNullableNum(raw.order_commission_rate);
    const commissionAmount =
      saleRevenue != null && commissionRate != null
        ? roundMoney((saleRevenue * commissionRate) / 100)
        : null;
    const timeToSaleMs =
      endReason === "sold" && raw.ended_at != null ? durationMs : null;

    const cycScanBucket = scanAttribution?.cycleScans.get(raw.cycle_id);
    return {
      cycleId: raw.cycle_id,
      posSpotId: raw.pos_spot_id,
      plantVariantId: raw.plant_variant_id,
      partnerId: raw.partner_id,
      partnerName: raw.partner_name,
      partnerLocationId: raw.partner_location_id,
      partnerLocationName: raw.partner_location_name,
      plantId: raw.plant_id,
      plantName: raw.plant_name,
      sizeLabel: raw.size_label,
      placementKind,
      startedAt: toIso(raw.started_at),
      endedAt: toNullableIso(raw.ended_at),
      endReason,
      isActive: raw.ended_at == null,
      durationMs,
      orderId: raw.order_id,
      soldAt: toNullableIso(raw.order_created_at),
      timeToSaleMs,
      saleRevenue,
      commissionRate,
      commissionAmount,
      saleSupplierUnitCost: toNullableNum(raw.order_supplier_unit_cost),
      scans: scansKnown ? (cycScanBucket?.scans ?? 0) : null,
      uniqueScanners: scansKnown ? (cycScanBucket?.distinctIds.size ?? 0) : null,
      segments: segmentsByCycle.get(raw.cycle_id) ?? [],
    };
  });

  // Pocket breakdown (from segment history; sales attributed to closing segment of sold cycles).
  const pocketMap = new Map<string, PocketPerformanceRow>();
  const sellableMap = new Map<string, VariantConfigPerformanceRow>();
  const potMap = new Map<string, VariantConfigPerformanceRow>();

  for (const cycle of placements) {
    const lastSegId =
      cycle.endReason === "sold" && cycle.segments.length > 0
        ? cycle.segments[cycle.segments.length - 1].segmentId
        : null;

    for (const seg of cycle.segments) {
      const isSaleSegment =
        lastSegId === seg.segmentId && cycle.endReason === "sold" && cycle.saleRevenue != null;
      const saleAdd = isSaleSegment ? 1 : 0;
      const revAdd = isSaleSegment && cycle.saleRevenue != null ? cycle.saleRevenue : 0;

      const pocketKey = `${cycle.partnerLocationId ?? "unknown"}::${seg.pocketId ?? "unassigned"}`;
      const pRow = pocketMap.get(pocketKey) ?? {
        partnerLocationId: cycle.partnerLocationId,
        pocketId: seg.pocketId,
        pocketName: seg.pocketName?.trim() || "(Unassigned / Unknown pocket)",
        segments: 0,
        totalDurationMs: 0,
        avgDurationMs: null,
        scans: scansKnown ? 0 : null,
        sales: 0,
        revenue: 0,
      };
      pRow.segments += 1;
      pRow.totalDurationMs += seg.durationMs;
      if (scansKnown && seg.scans != null) pRow.scans = (pRow.scans ?? 0) + seg.scans;
      pRow.sales += saleAdd;
      pRow.revenue = roundMoney(pRow.revenue + revAdd);
      pocketMap.set(pocketKey, pRow);

      const svKey = `${seg.sellableVariantId ?? "legacy"}::${cycle.plantVariantId}::${seg.potId ?? "none"}`;
      const svRow = sellableMap.get(svKey) ?? {
        sellableVariantId: seg.sellableVariantId,
        plantId: cycle.plantId,
        plantName: cycle.plantName?.trim() || cycle.plantId || "(Unknown plant)",
        sizeLabel: cycle.sizeLabel,
        potId: seg.potId,
        potName: seg.potName,
        segments: 0,
        totalDurationMs: 0,
        scans: scansKnown ? 0 : null,
        sales: 0,
        revenue: 0,
      };
      svRow.segments += 1;
      svRow.totalDurationMs += seg.durationMs;
      if (scansKnown && seg.scans != null) svRow.scans = (svRow.scans ?? 0) + seg.scans;
      svRow.sales += saleAdd;
      svRow.revenue = roundMoney(svRow.revenue + revAdd);
      sellableMap.set(svKey, svRow);

      if (seg.potId) {
        const potKey = seg.potId;
        const potRow = potMap.get(potKey) ?? {
          sellableVariantId: null,
          plantId: null,
          plantName: seg.potName?.trim() || seg.potId,
          sizeLabel: null,
          potId: seg.potId,
          potName: seg.potName?.trim() || "(Unknown pot)",
          segments: 0,
          totalDurationMs: 0,
          scans: scansKnown ? 0 : null,
          sales: 0,
          revenue: 0,
        };
        potRow.segments += 1;
        potRow.totalDurationMs += seg.durationMs;
        if (scansKnown && seg.scans != null) potRow.scans = (potRow.scans ?? 0) + seg.scans;
        potRow.sales += saleAdd;
        potRow.revenue = roundMoney(potRow.revenue + revAdd);
        potMap.set(potKey, potRow);
      }
    }
  }

  const byPocket = [...pocketMap.values()]
    .map((row) => ({
      ...row,
      avgDurationMs: row.segments > 0 ? Math.round(row.totalDurationMs / row.segments) : null,
    }))
    .sort((a, b) => b.totalDurationMs - a.totalDurationMs || a.pocketName.localeCompare(b.pocketName));

  const bySellableVariant = [...sellableMap.values()].sort(
    (a, b) => b.sales - a.sales || b.totalDurationMs - a.totalDurationMs,
  );
  const byPot = [...potMap.values()].sort(
    (a, b) => b.sales - a.sales || b.totalDurationMs - a.totalDurationMs,
  );

  const byPartner = buildGroupPerformance(
    placements,
    (c) => ({
      key: c.partnerId ?? "(unknown)",
      label: c.partnerName?.trim() || c.partnerId || "(Unknown partner)",
    }),
    scansKnown,
  );
  const byLocation = buildGroupPerformance(
    placements,
    (c) => ({
      key: c.partnerLocationId ?? "(unknown)",
      label: c.partnerLocationName?.trim() || c.partnerLocationId || "(Unknown location)",
    }),
    scansKnown,
  );
  const byPlant = buildGroupPerformance(
    placements,
    (c) => ({
      key: c.plantId ?? "(unknown)",
      label: c.plantName?.trim() || c.plantId || "(Unknown plant)",
    }),
    scansKnown,
  );
  const byPlantSize = buildGroupPerformance(
    placements,
    (c) => ({
      key: c.plantVariantId,
      label: `${c.plantName?.trim() || c.plantId || "(Unknown plant)"}${c.sizeLabel ? ` · ${c.sizeLabel}` : ""}`,
    }),
    scansKnown,
  );

  const totalScans = scansKnown ? (scanAttribution?.totalMatchedScans ?? 0) : null;
  const uniqueScanners = scansKnown ? (scanAttribution?.uniqueMatchedScanners.size ?? 0) : null;
  const soldPlacements = placements.filter((c) => c.endReason === "sold").length;
  const totalSales = placements.filter(
    (c) => c.endReason === "sold" && c.saleRevenue != null,
  ).length;
  const totalRevenue = roundMoney(
    placements.reduce((sum, c) => sum + (c.saleRevenue ?? 0), 0),
  );
  const totalCommissionAmount = roundMoney(
    placements.reduce((sum, c) => sum + (c.commissionAmount ?? 0), 0),
  );

  return {
    summary: {
      totalPlacements: placements.length,
      activePlacements: placements.filter((c) => c.isActive).length,
      soldPlacements,
      removedPlacements: placements.filter((c) => c.endReason === "removed").length,
      replacedPlacements: placements.filter((c) => c.endReason === "replaced").length,
      deactivatedPlacements: placements.filter((c) => c.endReason === "deactivated").length,
      initialPlacements: placements.filter((c) => c.placementKind === "initial").length,
      restockPlacements: placements.filter((c) => c.placementKind === "restock").length,
      unknownKindPlacements: legacyCyclesWithoutKind,
      avgDurationMs: avgOrNull(placements.map((c) => c.durationMs)),
      avgTimeToSaleMs: avgOrNull(
        placements
          .map((c) => c.timeToSaleMs)
          .filter((v): v is number => v != null),
      ),
      totalScans,
      uniqueScanners,
      totalSales,
      totalRevenue,
      totalCommissionAmount,
      scanToSalePercent:
        totalScans != null && totalScans > 0
          ? Math.round((totalSales / totalScans) * 1000) / 10
          : totalScans === 0
            ? 0
            : null,
    },
    byPartner,
    byLocation,
    byPocket,
    byPlant,
    byPlantSize,
    bySellableVariant,
    byPot,
    placements,
    reliability: {
      preSnapshotTrackingIncomplete: true,
      legacyCyclesWithoutKind,
      legacyCyclesWithoutPartnerSnapshot,
      segmentsWithoutCostSnapshot,
      unattributedScans: scansKnown ? (scanAttribution?.unattributedScans ?? 0) : null,
      truncatedPosthogScans,
    },
    posthogError,
  };
}
