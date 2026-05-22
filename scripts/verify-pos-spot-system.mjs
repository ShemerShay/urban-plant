import { neon } from "@neondatabase/serverless";
import { loadEnvLocal } from "./load-env-local.mjs";

await loadEnvLocal();
const sql = neon(process.env.DATABASE_URL);

async function check(label, fn) {
  try {
    await fn();
    console.log(`OK: ${label}`);
    return true;
  } catch (err) {
    console.error(`FAIL: ${label}`, err instanceof Error ? err.message : err);
    return false;
  }
}

let ok = true;

ok &&= await check("read pos_spots", async () => {
  const rows = await sql`SELECT id, spot_name, spot_slug, pocket FROM pos_spots LIMIT 5`;
  if (!rows.length) throw new Error("no pos spots");
  for (const r of rows) {
    if (!r.id || !r.spot_name || !r.spot_slug) throw new Error("missing required fields");
  }
});

ok &&= await check("slug lookup cafe-noir-front-shelf", async () => {
  const rows = await sql`
    SELECT id, spot_name, spot_slug FROM pos_spots WHERE spot_slug = ${"cafe-noir-front-shelf"} LIMIT 1
  `;
  if (!rows[0]) throw new Error("spot not found");
});

ok &&= await check("orders FK to pos_spots uuid", async () => {
  await sql`
    SELECT o.order_id, o.pos_spot_id, p.spot_slug
    FROM orders o
    LEFT JOIN pos_spots p ON p.id = o.pos_spot_id
    WHERE o.pos_spot_id IS NOT NULL
    LIMIT 3
  `;
});

ok &&= await check("events pos_spot_id is uuid column", async () => {
  const col = await sql`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'pos_spot_id'
  `;
  if (col[0]?.data_type !== "uuid") throw new Error(`expected uuid, got ${col[0]?.data_type}`);
});

if (!ok) process.exit(1);
console.log("\nCross-system DB checks passed.");
