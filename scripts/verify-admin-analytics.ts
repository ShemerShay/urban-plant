/**
 * Static checks for admin analytics wiring (no live PostHog/Neon calls).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const page = read("app/admin/analytics/page.tsx");
assert.match(page, /loadBusinessAnalytics/);
assert.match(page, /parseAnalyticsRange/);
assert.match(page, /getLocale/);

const dash = read("components/admin/AdminAnalyticsDashboard.tsx");
assert.match(dash, /analyticsRangeLabel/);
assert.match(dash, /admin\.analytics\.totalScans/);
assert.match(dash, /admin\.analytics\.uniqueScanners/);
assert.match(dash, /admin\.analytics\.purchases/);
assert.match(dash, /admin\.analytics\.purchasesPlants/);
assert.match(dash, /admin\.analytics\.purchasesFlowers/);
assert.match(dash, /admin\.analytics\.inventoryTypeFallback/);
assert.match(dash, /admin\.analytics\.scanToCheckout/);
assert.doesNotMatch(dash, /POSTHOG_PERSONAL_API_KEY/);

const ph = read("lib/analytics/posthogQuery.ts");
assert.match(ph, /server-only/);
assert.match(ph, /POSTHOG_PERSONAL_API_KEY/);
assert.match(ph, /HogQLQuery/);

const neon = read("lib/analytics/neonPurchases.ts");
assert.match(neon, /LEFT JOIN plants pl ON pl\.id = o\.product_id/);
assert.match(neon, /COALESCE\(pl\.inventory_type, 'plants'\)/);
assert.match(neon, /missing_catalog_cnt/);
assert.match(neon, /inventoryTypeFallback: "plants"/);
assert.match(neon, /order_status IN \('sold', 'picked_up', 'delivered'\)/);
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
assert.doesNotMatch(biz, /checkout_started/);
const messages = read("lib/messages.ts");
assert.match(messages, /Scan → Successful Purchase/);
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

const adminIndex = read("app/admin/page.tsx");
assert.match(adminIndex, /admin\.home\.analytics/);

const envExample = read(".env.example");
assert.match(envExample, /POSTHOG_PERSONAL_API_KEY/);
assert.match(envExample, /POSTHOG_PROJECT_ID/);

console.log("OK: admin analytics wiring verified");
