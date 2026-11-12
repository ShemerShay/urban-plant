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
assert.doesNotMatch(dash, /admin\.analytics\.posthogUnavailable/);
assert.doesNotMatch(dash, /admin\.analytics\.purchaseUnavailable/);
assert.match(dash, /admin\.analytics\.sourceError/);
assert.match(dash, /data\.posthogError/);
assert.match(dash, /data\.neonError/);
assert.match(dash, /admin\.analytics\.revenue/);
assert.match(dash, /admin\.analytics\.averageOrderValue/);
assert.match(dash, /admin\.analytics\.units/);
assert.match(dash, /admin\.analytics\.area\.overall/);
assert.match(dash, /admin\.analytics\.area\.logistics/);
assert.match(dash, /admin\.analytics\.area\.financial/);
assert.doesNotMatch(dash, /row\.name === "Catalog"/);
assert.match(dash, /scansOverTimeError/);
assert.match(dash, /admin\.analytics\.scansOverTimeUnavailable/);
assert.doesNotMatch(dash, /POSTHOG_PERSONAL_API_KEY/);
assert.doesNotMatch(dash, /analyticsWithRange/);
assert.doesNotMatch(dash, /ANALYTICS_RANGE_OPTIONS/);
assert.match(dash, /formatInstantInBusinessTimeZone/);
assert.doesNotMatch(dash, /getTimezoneOffset/);

const filters = read("components/admin/AdminAnalyticsFilters.tsx");
assert.match(filters, /INVENTORY_TYPES/);
assert.match(filters, /AdminDateFilter/);
assert.match(filters, /analyticsQueryUrl/);
assert.match(filters, /useTransition/);
assert.match(filters, /isPending/);
assert.doesNotMatch(filters, /runHogQLQuery/);
assert.doesNotMatch(filters, /getNeonPurchaseAnalytics/);

const dateFilterUi = read("components/admin/shared/AdminDateFilter.tsx");
assert.match(dateFilterUi, /react-day-picker/);
assert.match(dateFilterUi, /DayPicker/);
assert.match(dateFilterUi, /disabled=\{\{\s*after:/);
assert.match(dateFilterUi, /calendarRangeDraftToFilterValue/);
assert.match(dateFilterUi, /onSelect=\{setDraft\}/);
assert.match(dateFilterUi, /admin\.dateFilter\.apply/);
assert.match(dateFilterUi, /admin\.dateFilter\.cancel/);
assert.match(dateFilterUi, /discardAndClose/);
assert.match(dateFilterUi, /disabled=\{disabled\}/);
assert.doesNotMatch(dateFilterUi, /function applyCalendarRange/);
assert.doesNotMatch(dateFilterUi, /clampInclusiveCalendarRangeToToday/);
assert.doesNotMatch(dateFilterUi, /posthog/i);
assert.doesNotMatch(dateFilterUi, /neon/i);
assert.doesNotMatch(dateFilterUi, /analyticsQuery/);

const ph = read("lib/analytics/posthogQuery.ts");
assert.match(ph, /server-only/);
assert.match(ph, /POSTHOG_PERSONAL_API_KEY/);
assert.match(ph, /HogQLQuery/);
assert.doesNotMatch(ph, /AbortSignal\.timeout/);
assert.match(ph, /POSTHOG_QUERY_TIMEOUT_MS\s*=\s*15_000/);
assert.match(ph, /Promise\.race/);
assert.match(ph, /AbortController/);
assert.match(ph, /code: "timeout"/);
assert.match(ph, /response\.json\(\)/);
assert.match(ph, /options\?\.signal/);

const neon = read("lib/analytics/neonPurchases.ts");
assert.match(neon, /LEFT JOIN plants pl ON pl\.id = o\.product_id/);
assert.match(neon, /pl\.inventory_type/);
assert.match(neon, /snapshot->>'inventoryType'/);
assert.match(neon, /= 'plants'/);
assert.match(neon, /= 'flowers'/);
assert.doesNotMatch(neon, /<> 'flowers'/);
assert.match(neon, /missing_catalog_cnt/);
assert.match(neon, /inventoryTypeFallback: "plants"/);
assert.match(neon, /order_status IN \('sold', 'picked_up', 'delivered'\)/);
assert.match(neon, /created_at < \$\{endIso\}::timestamptz/);
assert.match(neon, /server-only/);
assert.match(neon, /o\.is_internal = false/);
assert.match(neon, /a\.is_internal = false/);
assert.match(neon, /o\.channel = 'catalog'/);
assert.match(neon, /o\.partner_id = \$\{partnerId\}/);
assert.match(neon, /INNER JOIN partners pr ON pr\.id = o\.partner_id/);
assert.doesNotMatch(neon, /THEN 'Catalog'/);
assert.match(neon, /FROM order_items oi/);
assert.match(neon, /needs_reconciliation/);
assert.doesNotMatch(neon, /alon shabo/i);
assert.doesNotMatch(neon, /0d11277b-9b47-45a5-ad80-22cf5c1ad2ef/);
assert.doesNotMatch(neon, /ef33137e-fe13-4be3-84bb-1f5b80557815/);
assert.doesNotMatch(neon, /NOT LIKE '%test%'/);
assert.doesNotMatch(neon, /NOT LIKE '%shemer%'/);
assert.doesNotMatch(neon, /NOT LIKE '%asaf%'/);
assert.doesNotMatch(neon, /ILIKE/);

const biz = read("lib/analytics/businessAnalytics.ts");
assert.match(biz, /pos_scan/);
assert.match(biz, /purchase_completed/);
assert.match(biz, /\$session_id/);
assert.match(biz, /properties\.pos_spot_id/);
assert.match(biz, /max_purchase_ts >= timestamp/);
assert.match(biz, /properties\.inventory_type/);
assert.match(biz, /ifNull\(nullIf\(toString\(properties\.inventory_type\), ''\), ''\) = ''/);
assert.match(biz, /resolveDateFilterBounds/);
assert.match(biz, /toTimeZone\(timestamp, \$\{hogqlQuote\(BUSINESS_TIME_ZONE\)\}\)/);
assert.match(biz, /toStartOfHour\(\$\{zoned\}\)/);
assert.match(biz, /toStartOfDay\(\$\{zoned\}\)/);
assert.match(biz, /toStartOfWeek\(\$\{zoned\}, 0\)/);
assert.doesNotMatch(biz, /toStartOfHour\(timestamp,/);
assert.doesNotMatch(biz, /toStartOfDay\(timestamp,/);
assert.doesNotMatch(biz, /toStartOfWeek\(timestamp,/);
assert.match(biz, /scansOverTimeError/);
assert.match(biz, /series\.ok \? null : series\.error/);
assert.match(biz, /ANALYTICS_EVENTS\.checkoutStarted/);
assert.match(biz, /ANALYTICS_EVENTS\.paymentStarted/);
assert.match(biz, /listAnalyticsLocations/);
assert.match(biz, /properties\.partner_id/);
assert.doesNotMatch(biz, /INTERVAL 7 DAY/);
assert.doesNotMatch(biz, /toStartOfDay\(now\(\)\)/);
const messages = read("lib/messages.ts");
assert.match(messages, /Scan → Successful Purchase/);
assert.match(messages, /admin\.dateFilter\.lastWeek/);
assert.match(messages, /admin\.dateFilter\.allTime/);
assert.match(messages, /admin\.dateFilter\.apply/);
assert.match(messages, /admin\.dateFilter\.cancel/);
assert.doesNotMatch(messages, /admin\.analytics\.posthogUnavailable/);
assert.doesNotMatch(messages, /admin\.analytics\.purchaseUnavailable/);
assert.match(messages, /admin\.analytics\.scansOverTimeUnavailable/);
assert.doesNotMatch(messages, /admin\.analytics\.last7/);
assert.doesNotMatch(messages, /admin\.analytics\.allTime/);
assert.match(biz, /console\.info/);
assert.match(biz, /\[admin-analytics\]/);
assert.match(biz, /load_start/);
assert.match(biz, /load_finish/);
assert.match(biz, /loadId/);
assert.match(biz, /cache: "hit"/);
assert.match(biz, /cache: "miss"/);
assert.match(biz, /cache: "wait"/);
assert.match(biz, /op: "internal_ids"/);
assert.match(biz, /op: "kpis"/);
assert.match(biz, /op: "series"/);
assert.match(biz, /op: "breakdowns"/);
assert.match(biz, /op: "neon"/);
assert.match(biz, /filters\.area === "financial"/);
assert.match(biz, /needSeries/);
assert.match(biz, /needBreakdowns/);
assert.match(biz, /Single PostHog wave/);
assert.match(biz, /timeout: outcome\.code === "timeout"/);
assert.match(biz, /ANALYTICS_LOAD_BUDGET_MS\s*=\s*25_000/);
assert.match(biz, /budgetExceeded/);
assert.match(biz, /op_start/);
assert.match(biz, /loadAbort\.abort\(\)/);
assert.match(biz, /runHogQLQuery\([^)]*\{\s*signal\s*\}/);
assert.doesNotMatch(biz, /logAnalyticsEvent\([^;]*internalIdsResult\.ids/);
assert.match(biz, /listInternalDistinctIds/);
assert.match(biz, /INTERNAL_IDS_TTL_MS/);
assert.match(biz, /2020-01-01/);
assert.match(biz, /posthogCustomerScope/);
assert.match(biz, /properties\.is_internal/);
assert.match(biz, /distinct_id NOT IN/);
assert.doesNotMatch(biz, /POSTHOG_EXCLUDE_INTERNAL_DEVICES/);
assert.doesNotMatch(biz, /UNION ALL/);
assert.match(biz, /GROUP BY plant_name, location_id, pocket_name/);
assert.match(biz, /listPlantIdsByInventoryType/);
assert.match(biz, /Catalog lookup failed/);
assert.doesNotMatch(biz, /alon shabo/i);
assert.doesNotMatch(biz, /0d11277b-9b47-45a5-ad80-22cf5c1ad2ef/);
assert.doesNotMatch(biz, /ef33137e-fe13-4be3-84bb-1f5b80557815/);
assert.doesNotMatch(biz, /POSTHOG_EXCLUDE_TEST/);
assert.doesNotMatch(biz, /POSTHOG_INCLUDE_PARTNERS/);
assert.match(biz, /POSTHOG_EXCLUDE_LOCALHOST/);
assert.match(biz, /POSTHOG_EXCLUDE_ACCIDENTAL_SCANS/);
assert.match(biz, /01a057e8-4ec9-78c1-b9a8-b9dfa4c6ffd7/);
assert.match(biz, /Accidental internal incognito scan from 2026-08-31/);
assert.match(biz, /properties\.\$host/);
assert.doesNotMatch(biz, /posthog_distinct_id/);
assert.doesNotMatch(biz, /posthog_session_id/);

const migration = read("db/migrations/054_analytics_internal.sql");
assert.match(migration, /payment_attempts/);
assert.match(migration, /orders/);
assert.match(migration, /is_internal boolean NOT NULL DEFAULT false/);
assert.doesNotMatch(migration, /posthog_distinct_id/);
assert.doesNotMatch(migration, /posthog_session_id/);
assert.doesNotMatch(migration, /ILIKE/);
assert.doesNotMatch(migration, /UPDATE orders/);

const exactInternal = read("db/migrations/055_orders_exact_internal_ids.sql");
assert.match(exactInternal, /UPDATE orders/);
assert.match(exactInternal, /SET is_internal = true/);
assert.match(exactInternal, /220f4c61-47e0-47ad-9b37-8b5977bdf804/);
assert.match(exactInternal, /2e3e6e45-5b0d-4552-b6b9-a43ff6a50848/);
assert.match(exactInternal, /78caebdb-1897-4256-a214-9656d2e43f82/);
assert.match(exactInternal, /800e74ec-c3d6-4322-84d8-2c598f33ee09/);
assert.match(exactInternal, /2ed32aca-2fc8-4e28-8643-31124faa5b36/);
assert.doesNotMatch(exactInternal, /ILIKE/);
assert.doesNotMatch(exactInternal, /\bLIKE\b/);
assert.doesNotMatch(exactInternal, /UPDATE payment_attempts/);
assert.doesNotMatch(exactInternal, /full_name|customer_email/);

const prep = read("lib/startCardcomPaymentPrep.ts");
assert.match(prep, /inventoryType/);
assert.match(prep, /plantVariantId/);
assert.match(prep, /sizeLabel/);
assert.match(prep, /isInternal/);
assert.doesNotMatch(prep, /posthog_distinct_id/);
assert.doesNotMatch(prep, /posthog_session_id/);

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
assert.match(dateFilterSrc, /"all_time"/);
assert.match(dateFilterSrc, /ALL_TIME_FILTER_FROM/);
assert.match(dateFilterSrc, /normalizeDateFilterValue/);
assert.match(dateFilterSrc, /defaultDateFilterValue/);
assert.match(dateFilterSrc, /calendarRangeDraftToFilterValue/);
assert.doesNotMatch(dateFilterSrc, /clampInclusiveCalendarRangeToToday/);
assert.doesNotMatch(
  dateFilterSrc,
  /DEFAULT_DATE_FILTER_PRESET:\s*DateFilterPresetId\s*=\s*"last_week"/,
);

const filterUi = read("components/admin/AdminAnalyticsFilters.tsx");
assert.match(filterUi, /flex-row flex-wrap/);
assert.match(filterUi, /min-w-40 flex-1/);
assert.match(filterUi, /admin\.dateFilter\.allTime/);
assert.match(filterUi, /all_time/);

const adminIndex = read("app/admin/page.tsx");
assert.match(adminIndex, /routes\.admin\.analytics\(\)/);

const envExample = read(".env.example");
assert.match(envExample, /POSTHOG_PERSONAL_API_KEY/);
assert.match(envExample, /POSTHOG_PROJECT_ID/);

assert.equal(DEFAULT_ANALYTICS_INVENTORY_FILTER, "plants");
assert.equal(DEFAULT_DATE_FILTER_PRESET, "today");

const loading = read("app/admin/analytics/loading.tsx");
assert.match(loading, /admin-analytics-loading/);
assert.match(loading, /admin\.common\.loading/);
assert.match(loading, /aria-busy/);

const emptyFilters = parseAnalyticsFilterState({});
assert.equal(emptyFilters.inventoryType, "plants");
assert.equal(emptyFilters.partnerId, null);
assert.equal(emptyFilters.area, "overall");
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

const allTimeUrl = parseAnalyticsFilterState({ date: "all_time" });
assert.deepEqual(allTimeUrl.dateFilter, { mode: "preset", presetId: "all_time" });
assert.match(analyticsQueryUrl(allTimeUrl), /date=all_time/);

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
