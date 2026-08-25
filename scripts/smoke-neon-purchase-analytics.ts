/**
 * Live smoke: Neon verified purchase totals (mirrors admin analytics SQL).
 * Run: npx tsx scripts/smoke-neon-purchase-analytics.ts
 */
import assert from "node:assert/strict";
import { neon } from "@neondatabase/serverless";
import { loadEnvLocal } from "./load-env-local.mjs";

async function main() {
  await loadEnvLocal();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neon(url);

  const all = (await sql`
    SELECT COUNT(*)::int AS cnt
    FROM orders
    WHERE order_status IN ('sold', 'picked_up', 'delivered')
  `) as { cnt: number }[];

  const weekFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const week = (await sql`
    SELECT COUNT(*)::int AS cnt
    FROM orders
    WHERE order_status IN ('sold', 'picked_up', 'delivered')
      AND created_at >= ${weekFrom}::timestamptz
  `) as { cnt: number }[];

  const plants = (await sql`
    SELECT
      COALESCE(
        NULLIF(TRIM(product_name), ''),
        NULLIF(TRIM(snapshot->>'productName'), ''),
        product_id,
        'Unknown plant'
      ) AS name,
      COUNT(*)::int AS cnt
    FROM orders
    WHERE order_status IN ('sold', 'picked_up', 'delivered')
    GROUP BY 1
    ORDER BY cnt DESC
    LIMIT 5
  `) as { name: string; cnt: number }[];

  const breakdown = (await sql`
    SELECT
      COUNT(*)::int AS cnt,
      COUNT(*) FILTER (
        WHERE COALESCE(pl.inventory_type, 'plants') = 'flowers'
      )::int AS flowers_cnt,
      COUNT(*) FILTER (
        WHERE COALESCE(pl.inventory_type, 'plants') <> 'flowers'
      )::int AS plants_cnt,
      COUNT(*) FILTER (WHERE pl.id IS NULL)::int AS missing_catalog_cnt
    FROM orders o
    LEFT JOIN plants pl ON pl.id = o.product_id
    WHERE o.order_status IN ('sold', 'picked_up', 'delivered')
  `) as {
    cnt: number;
    flowers_cnt: number;
    plants_cnt: number;
    missing_catalog_cnt: number;
  }[];

  const allCount = Number(all[0]?.cnt ?? 0);
  const weekCount = Number(week[0]?.cnt ?? 0);
  const plantsCount = Number(breakdown[0]?.plants_cnt ?? 0);
  const flowersCount = Number(breakdown[0]?.flowers_cnt ?? 0);
  const missingCatalogCount = Number(breakdown[0]?.missing_catalog_cnt ?? 0);
  assert.ok(allCount >= weekCount);
  assert.equal(Number(breakdown[0]?.cnt ?? 0), allCount);
  assert.equal(plantsCount + flowersCount, allCount);
  console.log("all-time purchases:", allCount);
  console.log("last-7d purchases:", weekCount);
  console.log("purchases plants:", plantsCount);
  console.log("purchases flowers:", flowersCount);
  console.log(
    "missing catalog (counted as plants, fallback=plants):",
    missingCatalogCount,
  );
  console.log("top plants:", plants);
  console.log("OK: neon purchase analytics smoke");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
