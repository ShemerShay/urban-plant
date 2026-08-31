/**
 * Static checks for admin analytics wiring (no live PostHog/Neon calls).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  analyticsQueryUrl,
  DEFAULT_ANALYTICS_INVENTORY_FILTER,
  parseAnalyticsFilterState,
} from "../lib/analytics/analyticsQuery";
import { DEFAULT_DATE_FILTER_PRESET } from "../lib/dateFilter";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const page = read("app/admin/analytics/page.tsx");
assert.match(page, /loadBusinessAnalytics/);
assert.match(page, /parseAnalyticsFilterState/);
assert.match(page, /getLocale/);
assert.doesNotMatch(page, /parseAnalyticsRange/);
assert.doesNotMatch(page, /searchParams.*range/);

const dash = read("components/admin/AdminAnalyticsDashboard.tsx");
assert.match(dash, /AdminAnalyticsFilters/);
assert.match(dash, /admin\.analytics\.totalScans/);
assert.match(dash, /admin\.analytics\.uniqueScanners/);
assert.match(dash, /admin\.analytics\.purchases/);
assert.match(dash, /admin\.analytics\.purchasesPlants/);
assert.match(dash, /admin\.analytics\.purchasesFlowers/);
assert.match(dash, /admin\.analytics\.inventoryTypeFallback/);
assert.match(dash, /admin\.analytics\.scanToCheckout/);
assert.match(dash, /admin\.analytics\.topProductsScans/);
assert.doesNotMatch(dash, /POSTHOG_PERSONAL_API_KEY/);
assert.doesNotMatch(dash, /analyticsWithRange/);
assert.doesNotMatch(dash, /ANALYTICS_RANGE_OPTIONS/);
assert.match(dash, /formatInstantInBusinessTimeZone/);
assert.doesNotMatch(dash, /getTimezoneOffset/);

const filters = read("components/admin/AdminAnalyticsFilters.tsx");
assert.match(filters, /INVENTORY_TYPES/);
assert.match(filters, /AdminDateFilter/);
assert.match(filters, /analyticsQueryUrl/);
assert.doesNotMatch(filters, /runHogQLQuery/);
assert.doesNotMatch(filters, /getNeonPurchaseAnalytics/);

const dateFilterUi = read("components/admin/shared/AdminDateFilter.tsx");
assert.match(dateFilterUi, /react-day-picker/);
assert.match(dateFilterUi, /DayPicker/);
assert.match(dateFilterUi, /disabled=\{\{\s*after:/);
assert.match(dateFilterUi, /normalizeDateFilterValue/);
assert.doesNotMatch(dateFilterUi, /clampInclusiveCalendarRangeToToday/);
assert.doesNotMatch(dateFilterUi, /posthog/i);
assert.doesNotMatch(dateFilterUi, /neon/i);
assert.doesNotMatch(dateFilterUi, /analyticsQuery/);

const ph = read("lib/analytics/posthogQuery.ts");
assert.match(ph, /server-only/);
assert.match(ph, /POSTHOG_PERSONAL_API_KEY/);
assert.match(ph, /HogQLQuery/);

const neon = read("lib/analytics/neonPurchases.ts");
assert.match(neon, /LEFT JOIN plants pl ON pl\.id = o\.product_id/);
assert.match(neon, /COALESCE\(pl\.inventory_type, 'plants'\) = 'plants'/);
assert.match(neon, /COALESCE\(pl\.inventory_type, 'plants'\) = 'flowers'/);
assert.doesNotMatch(neon, /<> 'flowers'/);
assert.match(neon, /missing_catalog_cnt/);
assert.match(neon, /inventoryTypeFallback: "plants"/);
assert.match(neon, /order_status IN \('sold', 'picked_up', 'delivered'\)/);
assert.match(neon, /created_at < \$\{endIso\}::timestamptz/);
assert.match(neon, /server-only/);
assert.match(neon, /alon shabo/);
assert.match(neon, /0d11277b-9b47-45a5-ad80-22cf5c1ad2ef/);
assert.match(neon, /ef33137e-fe13-4be3-84bb-1f5b80557815/);
assert.match(neon, /NOT LIKE '%test%'/);
assert.match(neon, /NOT LIKE '%shemer%'/);
assert.match(neon, /NOT LIKE '%asaf%'/);
assert.match(neon, /NOT LIKE '%שמר%'/);
assert.match(neon, /NOT LIKE '%doh%'/);
assert.match(neon, /NOT LIKE '%sh50%'/);
assert.match(neon, /NOT LIKE '%dohsh50%'/);

const biz = read("lib/analytics/businessAnalytics.ts");
assert.match(biz, /pos_scan/);
assert.match(biz, /purchase_completed/);
assert.match(biz, /\$session_id/);
assert.match(biz, /properties\.pos_spot_id/);
assert.match(biz, /max_purchase_ts >= timestamp/);
assert.match(biz, /properties\.inventory_type/);
assert.match(biz, /ifNull\(nullIf\(toString\(properties\.inventory_type\), ''\), ''\) = ''/);
assert.match(biz, /resolveDateFilterBounds/);
assert.doesNotMatch(biz, /checkout_started/);
assert.doesNotMatch(biz, /INTERVAL 7 DAY/);
assert.doesNotMatch(biz, /toStartOfDay\(now\(\)\)/);
const messages = read("lib/messages.ts");
assert.match(messages, /Scan → Successful Purchase/);
assert.match(messages, /admin\.dateFilter\.lastWeek/);
assert.doesNotMatch(messages, /admin\.analytics\.last7/);
assert.doesNotMatch(messages, /admin\.analytics\.allTime/);
assert.match(biz, /POSTHOG_EXCLUDE_INTERNAL_DEVICES/);
assert.match(biz, /POSTHOG_CUSTOMER_SCOPE/);
assert.match(biz, /properties\.is_internal/);
assert.match(biz, /distinct_id NOT IN/);
assert.match(biz, /alon shabo/);
assert.match(biz, /0d11277b-9b47-45a5-ad80-22cf5c1ad2ef/);
assert.match(biz, /ef33137e-fe13-4be3-84bb-1f5b80557815/);
assert.match(biz, /POSTHOG_EXCLUDE_TEST/);
assert.match(biz, /POSTHOG_EXCLUDE_LOCALHOST/);
assert.match(biz, /properties\.\$host/);

const routes = read("lib/routes.ts");
assert.match(routes, /analytics:\s*\(\)\s*=>\s*"\/admin\/analytics"/);
assert.match(routes, /analyticsWithQuery/);
assert.doesNotMatch(routes, /analyticsWithRange/);
assert.doesNotMatch(routes, /range=\$/);

const query = read("lib/analytics/analyticsQuery.ts");
assert.doesNotMatch(query, /params\.set\("range"/);
assert.doesNotMatch(query, /\brange=/);
assert.match(query, /inventoryType/);
assert.match(query, /DEFAULT_DATE_FILTER_PRESET/);
assert.match(query, /DEFAULT_ANALYTICS_INVENTORY_FILTER/);
assert.match(query, /DEFAULT_INVENTORY_TYPE/);
assert.match(query, /v === "all"/);
assert.doesNotMatch(query, /parseInventoryType\(raw\) \?\? "all"/);
assert.match(query, /normalizeDateFilterValue/);
assert.match(query, /defaultDateFilterValue/);

const dateFilterSrc = read("lib/dateFilter.ts");
assert.match(
  dateFilterSrc,
  /DEFAULT_DATE_FILTER_PRESET:\s*DateFilterPresetId\s*=\s*"today"/,
);
assert.match(dateFilterSrc, /normalizeDateFilterValue/);
assert.match(dateFilterSrc, /defaultDateFilterValue/);
assert.doesNotMatch(dateFilterSrc, /clampInclusiveCalendarRangeToToday/);
assert.doesNotMatch(
  dateFilterSrc,
  /DEFAULT_DATE_FILTER_PRESET:\s*DateFilterPresetId\s*=\s*"last_week"/,
);

const filterUi = read("components/admin/AdminAnalyticsFilters.tsx");
assert.match(filterUi, /flex-row flex-wrap/);
assert.match(filterUi, /min-w-40 flex-1/);

const adminIndex = read("app/admin/page.tsx");
assert.match(adminIndex, /admin\.home\.analytics/);

const envExample = read(".env.example");
assert.match(envExample, /POSTHOG_PERSONAL_API_KEY/);
assert.match(envExample, /POSTHOG_PROJECT_ID/);

assert.equal(DEFAULT_ANALYTICS_INVENTORY_FILTER, "plants");
assert.equal(DEFAULT_DATE_FILTER_PRESET, "today");

const emptyFilters = parseAnalyticsFilterState({});
assert.equal(emptyFilters.inventoryType, "plants");
assert.deepEqual(emptyFilters.dateFilter, { mode: "preset", presetId: "today" });
assert.equal(analyticsQueryUrl(emptyFilters), "/admin/analytics");

const allLastWeek = parseAnalyticsFilterState({
  inventoryType: "all",
  date: "last_week",
});
assert.equal(allLastWeek.inventoryType, "all");
assert.deepEqual(allLastWeek.dateFilter, { mode: "preset", presetId: "last_week" });
assert.match(analyticsQueryUrl(allLastWeek), /inventoryType=all/);
assert.match(analyticsQueryUrl(allLastWeek), /date=last_week/);

const frozenNow = new Date("2026-08-31T12:00:00.000Z");
const pastToFuture = parseAnalyticsFilterState(
  { from: "2026-08-10", to: "2026-09-15" },
  frozenNow,
);
assert.deepEqual(pastToFuture.dateFilter, {
  mode: "range",
  from: "2026-08-10",
  to: "2026-08-31",
});
assert.match(analyticsQueryUrl(pastToFuture), /from=2026-08-10/);
assert.match(analyticsQueryUrl(pastToFuture), /to=2026-08-31/);

const futureOnlyUrl = parseAnalyticsFilterState(
  { from: "2026-09-01", to: "2026-09-10" },
  frozenNow,
);
assert.deepEqual(futureOnlyUrl.dateFilter, { mode: "preset", presetId: "today" });
assert.equal(analyticsQueryUrl(futureOnlyUrl), "/admin/analytics");

console.log("OK: admin analytics wiring verified");
