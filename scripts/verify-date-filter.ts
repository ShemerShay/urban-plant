/**
 * Calendar-day bounds in Asia/Jerusalem for shared date filter presets.
 */
import assert from "node:assert/strict";
import {
  addCalendarDays,
  calendarRangeDraftToFilterValue,
  calendarRangeForPreset,
  calendarRangeForValue,
  DEFAULT_DATE_FILTER_PRESET,
  defaultDateFilterValue,
  formatInstantInBusinessTimeZone,
  inclusiveCalendarDayCount,
  normalizeDateFilterValue,
  resolveDateFilterBounds,
  timeGranularityForCalendarRange,
  zonedStartOfDay,
} from "../lib/dateFilter";

const now = new Date("2026-08-31T12:00:00.000Z");

const today = calendarRangeForPreset("today", now);
assert.equal(today.from, "2026-08-31");
assert.equal(today.to, "2026-08-31");

const week = calendarRangeForPreset("last_week", now);
assert.equal(week.from, "2026-08-25");
assert.equal(week.to, "2026-08-31");
assert.equal(inclusiveCalendarDayCount(week.from, week.to), 7);

const month = calendarRangeForPreset("last_month", now);
assert.equal(month.from, "2026-08-02");
assert.equal(month.to, "2026-08-31");
assert.equal(inclusiveCalendarDayCount(month.from, month.to), 30);

const todayBounds = resolveDateFilterBounds({ mode: "preset", presetId: "today" }, now);
assert.equal(todayBounds.startInclusive.toISOString(), "2026-08-30T21:00:00.000Z");
assert.equal(todayBounds.endExclusive.toISOString(), "2026-08-31T21:00:00.000Z");

const weekBounds = resolveDateFilterBounds({ mode: "preset", presetId: "last_week" }, now);
assert.equal(weekBounds.startInclusive.toISOString(), "2026-08-24T21:00:00.000Z");
assert.equal(weekBounds.endExclusive.toISOString(), "2026-08-31T21:00:00.000Z");

const monthBounds = resolveDateFilterBounds({ mode: "preset", presetId: "last_month" }, now);
assert.equal(monthBounds.startInclusive.toISOString(), "2026-08-01T21:00:00.000Z");
assert.equal(monthBounds.endExclusive.toISOString(), "2026-08-31T21:00:00.000Z");

const allTime = calendarRangeForPreset("all_time", now);
assert.equal(allTime.from, "2020-01-01");
assert.equal(allTime.to, "2026-08-31");
const allTimeBounds = resolveDateFilterBounds({ mode: "preset", presetId: "all_time" }, now);
assert.equal(allTimeBounds.startInclusive.toISOString(), "2019-12-31T22:00:00.000Z");
assert.equal(allTimeBounds.endExclusive.toISOString(), "2026-08-31T21:00:00.000Z");
assert.equal(timeGranularityForCalendarRange(allTime.from, allTime.to), "week");

const custom = resolveDateFilterBounds(
  { mode: "range", from: "2026-08-10", to: "2026-08-15" },
  now,
);
assert.equal(custom.startInclusive.toISOString(), "2026-08-09T21:00:00.000Z");
assert.equal(custom.endExclusive.toISOString(), "2026-08-15T21:00:00.000Z");
assert.equal(addCalendarDays("2026-08-15", 1), "2026-08-16");

const clampedEnd = normalizeDateFilterValue(
  { mode: "range", from: "2026-08-10", to: "2026-09-15" },
  now,
);
assert.deepEqual(clampedEnd, { mode: "range", from: "2026-08-10", to: "2026-08-31" });
assert.deepEqual(calendarRangeForValue(clampedEnd, now), { from: "2026-08-10", to: "2026-08-31" });

const futureOnly = normalizeDateFilterValue(
  { mode: "range", from: "2026-09-01", to: "2026-09-10" },
  now,
);
assert.deepEqual(futureOnly, defaultDateFilterValue());
assert.deepEqual(futureOnly, { mode: "preset", presetId: DEFAULT_DATE_FILTER_PRESET });
assert.deepEqual(calendarRangeForValue(futureOnly, now), calendarRangeForPreset("today", now));

const jerusalemEve = normalizeDateFilterValue(
  { mode: "range", from: "2026-08-31", to: "2026-09-01" },
  new Date("2026-08-31T20:30:00.000Z"),
);
assert.deepEqual(jerusalemEve, { mode: "range", from: "2026-08-31", to: "2026-08-31" });

const afterJerusalemMidnight = normalizeDateFilterValue(
  { mode: "range", from: "2026-09-01", to: "2026-09-02" },
  new Date("2026-08-31T21:30:00.000Z"),
);
assert.deepEqual(afterJerusalemMidnight, { mode: "range", from: "2026-09-01", to: "2026-09-01" });

assert.equal(
  formatInstantInBusinessTimeZone(new Date("2026-08-31T04:00:00.000Z"), "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }),
  "07:00",
);
assert.equal(
  formatInstantInBusinessTimeZone(new Date("2026-01-15T04:00:00.000Z"), "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }),
  "06:00",
);

assert.equal(timeGranularityForCalendarRange("2026-08-31", "2026-08-31"), "hour");
assert.equal(timeGranularityForCalendarRange("2026-08-25", "2026-08-31"), "day");
assert.equal(timeGranularityForCalendarRange("2026-08-02", "2026-08-31"), "week");

assert.equal(DEFAULT_DATE_FILTER_PRESET, "today");
assert.deepEqual(
  resolveDateFilterBounds({ mode: "preset", presetId: DEFAULT_DATE_FILTER_PRESET }, now),
  todayBounds,
);

const jerusalemNoon = new Date("2026-08-31T12:00:00.000Z");
const dayFrom = zonedStartOfDay("2026-08-10", "Asia/Jerusalem");
const dayTo = zonedStartOfDay("2026-08-15", "Asia/Jerusalem");
assert.equal(calendarRangeDraftToFilterValue(undefined, dayTo, now), undefined);
assert.deepEqual(calendarRangeDraftToFilterValue(dayFrom, undefined, now), {
  mode: "range",
  from: "2026-08-10",
  to: "2026-08-10",
});
assert.deepEqual(calendarRangeDraftToFilterValue(dayFrom, dayTo, now), {
  mode: "range",
  from: "2026-08-10",
  to: "2026-08-15",
});
assert.deepEqual(calendarRangeDraftToFilterValue(dayTo, dayFrom, now), {
  mode: "range",
  from: "2026-08-10",
  to: "2026-08-15",
});
assert.deepEqual(
  calendarRangeDraftToFilterValue(
    zonedStartOfDay("2026-09-10", "Asia/Jerusalem"),
    zonedStartOfDay("2026-09-12", "Asia/Jerusalem"),
    jerusalemNoon,
  ),
  defaultDateFilterValue(),
);

console.log("OK: date filter bounds verified");
