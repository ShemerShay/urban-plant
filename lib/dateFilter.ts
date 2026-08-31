/**
 * Shared admin date-filter value + Asia/Jerusalem calendar-day bounds.
 * UI components must not import analytics/PostHog/Neon from here.
 */

export const BUSINESS_TIME_ZONE = "Asia/Jerusalem";

export const DATE_FILTER_PRESETS = ["today", "last_week", "last_month"] as const;
export type DateFilterPresetId = (typeof DATE_FILTER_PRESETS)[number];

export const DEFAULT_DATE_FILTER_PRESET: DateFilterPresetId = "today";

export type DateFilterValue =
  | { mode: "preset"; presetId: string }
  | { mode: "range"; from: string; to: string };

export type ResolvedDateRange = {
  /** Inclusive calendar start as an instant. */
  startInclusive: Date;
  /** Exclusive end instant (start of the calendar day after `to`). */
  endExclusive: Date;
  /** Inclusive YYYY-MM-DD in the business timezone. */
  from: string;
  /** Inclusive YYYY-MM-DD in the business timezone. */
  to: string;
};

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateFilterPresetId(value: unknown): value is DateFilterPresetId {
  return value === "today" || value === "last_week" || value === "last_month";
}

export function isCalendarYmd(value: unknown): value is string {
  if (typeof value !== "string" || !YMD_RE.test(value)) return false;
  const [, ys, ms, ds] = value.match(YMD_RE) ?? [];
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function parseCalendarYmd(raw: string | undefined | null): string | undefined {
  const v = (raw ?? "").trim();
  return isCalendarYmd(v) ? v : undefined;
}

export function calendarYmdInTimeZone(
  now: Date,
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Shift a YYYY-MM-DD by whole calendar days (not timezone-dependent). */
export function addCalendarDays(ymd: string, days: number): string {
  const [, ys, ms, ds] = ymd.match(YMD_RE) ?? [];
  const dt = new Date(Date.UTC(Number(ys), Number(ms) - 1, Number(ds) + days));
  return dt.toISOString().slice(0, 10);
}

export function inclusiveCalendarDayCount(from: string, to: string): number {
  const a = Date.UTC(...ymdTuple(from));
  const b = Date.UTC(...ymdTuple(to));
  return Math.floor((b - a) / 86_400_000) + 1;
}

function ymdTuple(ymd: string): [number, number, number] {
  const [, ys, ms, ds] = ymd.match(YMD_RE) ?? [];
  return [Number(ys), Number(ms) - 1, Number(ds)];
}

function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - instant.getTime();
}

/** Instant of 00:00:00.000 on `ymd` in `timeZone`. */
export function zonedStartOfDay(ymd: string, timeZone: string = BUSINESS_TIME_ZONE): Date {
  const [y, monthIndex, d] = ymdTuple(ymd);
  let utcGuess = Date.UTC(y, monthIndex, d, 0, 0, 0);
  for (let i = 0; i < 3; i += 1) {
    const offset = tzOffsetMs(new Date(utcGuess), timeZone);
    utcGuess = Date.UTC(y, monthIndex, d, 0, 0, 0) - offset;
  }
  return new Date(utcGuess);
}

export function calendarRangeForPreset(
  presetId: DateFilterPresetId,
  now: Date = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
): { from: string; to: string } {
  const today = calendarYmdInTimeZone(now, timeZone);
  switch (presetId) {
    case "today":
      return { from: today, to: today };
    case "last_week":
      return { from: addCalendarDays(today, -6), to: today };
    case "last_month":
      return { from: addCalendarDays(today, -29), to: today };
  }
}

export function defaultDateFilterValue(): DateFilterValue {
  return { mode: "preset", presetId: DEFAULT_DATE_FILTER_PRESET };
}

/**
 * Canonical date-filter value.
 * Past→future custom ranges keep `from` and clamp `to` to today.
 * Future-only ranges are invalid and become the default preset (Today).
 */
export function normalizeDateFilterValue(
  value: DateFilterValue,
  now: Date = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
): DateFilterValue {
  if (value.mode !== "range") {
    return isDateFilterPresetId(value.presetId)
      ? { mode: "preset", presetId: value.presetId }
      : defaultDateFilterValue();
  }
  const today = calendarYmdInTimeZone(now, timeZone);
  const from = value.from <= value.to ? value.from : value.to;
  const to = value.from <= value.to ? value.to : value.from;
  if (from > today) return defaultDateFilterValue();
  return { mode: "range", from, to: to > today ? today : to };
}

export function calendarRangeForValue(
  value: DateFilterValue,
  now: Date = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
): { from: string; to: string } {
  const normalized = normalizeDateFilterValue(value, now, timeZone);
  if (normalized.mode === "range") {
    return { from: normalized.from, to: normalized.to };
  }
  return calendarRangeForPreset(
    isDateFilterPresetId(normalized.presetId)
      ? normalized.presetId
      : DEFAULT_DATE_FILTER_PRESET,
    now,
    timeZone,
  );
}

export function resolveDateFilterBounds(
  value: DateFilterValue,
  now: Date = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
): ResolvedDateRange {
  const { from, to } = calendarRangeForValue(value, now, timeZone);
  return {
    from,
    to,
    startInclusive: zonedStartOfDay(from, timeZone),
    endExclusive: zonedStartOfDay(addCalendarDays(to, 1), timeZone),
  };
}

/** Format an instant in the business timezone (DST-aware). */
export function formatInstantInBusinessTimeZone(
  instant: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: BUSINESS_TIME_ZONE,
  }).format(instant);
}

export type TimeGranularity = "hour" | "day" | "week";

export function timeGranularityForCalendarRange(from: string, to: string): TimeGranularity {
  const days = inclusiveCalendarDayCount(from, to);
  if (days <= 1) return "hour";
  if (days <= 8) return "day";
  return "week";
}
