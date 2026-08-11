import "server-only";

/**
 * Admin analytics date ranges (query param `range`).
 * Bounds are inclusive from `from` (ISO) through now for filtering Neon;
 * PostHog uses matching HogQL interval expressions.
 */

export type AnalyticsRangeKey = "today" | "7d" | "30d" | "all";

export const ANALYTICS_RANGE_OPTIONS: ReadonlyArray<{
  key: AnalyticsRangeKey;
  label: string;
}> = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "all", label: "All time" },
];

export const DEFAULT_ANALYTICS_RANGE: AnalyticsRangeKey = "7d";

export function parseAnalyticsRange(raw: string | undefined | null): AnalyticsRangeKey {
  const v = (raw ?? "").trim();
  if (v === "today" || v === "7d" || v === "30d" || v === "all") return v;
  return DEFAULT_ANALYTICS_RANGE;
}

/** HogQL timestamp predicate for the selected range (project timezone via PostHog `now()`). */
export function posthogTimestampPredicate(range: AnalyticsRangeKey): string {
  switch (range) {
    case "today":
      return "timestamp >= toStartOfDay(now())";
    case "7d":
      return "timestamp >= now() - INTERVAL 7 DAY";
    case "30d":
      return "timestamp >= now() - INTERVAL 30 DAY";
    case "all":
      return "timestamp >= toDateTime('2020-01-01 00:00:00')";
  }
}

/**
 * Time-bucket expression for scans-over-time.
 * Daily for short ranges; weekly for longer ones.
 */
export function posthogTimeBucketExpr(range: AnalyticsRangeKey): {
  expr: string;
  granularity: "hour" | "day" | "week";
} {
  switch (range) {
    case "today":
      return { expr: "toStartOfHour(timestamp)", granularity: "hour" };
    case "7d":
      return { expr: "toStartOfDay(timestamp)", granularity: "day" };
    case "30d":
    case "all":
      return { expr: "toStartOfWeek(timestamp)", granularity: "week" };
  }
}

/** Neon `created_at` lower bound (ISO). `null` means no lower bound (all time). */
export function neonCreatedAtFrom(range: AnalyticsRangeKey, now = new Date()): Date | null {
  switch (range) {
    case "today": {
      const d = new Date(now);
      d.setUTCHours(0, 0, 0, 0);
      return d;
    }
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "all":
      return null;
  }
}
