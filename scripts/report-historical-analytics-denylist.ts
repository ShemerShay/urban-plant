/**
 * Read-only report of orders matching the retired analytics denylist.
 * Does not update rows. Prints id, time, channel, status, price, and rule only.
 */
import { neon } from "@neondatabase/serverless";

import { loadEnvLocal } from "./load-env-local.mjs";

async function main() {
  await loadEnvLocal();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neon(url);
  const rows = (await sql`
    SELECT
      o.order_id,
      o.created_at,
      o.channel,
      o.order_status,
      o.price,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN LOWER(COALESCE(o.full_name, '')) LIKE '%shemer%' THEN 'full_name:shemer' END,
        CASE WHEN LOWER(COALESCE(o.full_name, '')) LIKE '%asaf%' THEN 'full_name:asaf' END,
        CASE WHEN COALESCE(o.full_name, '') LIKE '%שמר%' THEN 'full_name:שמר' END,
        CASE WHEN LOWER(COALESCE(o.customer_email, '')) LIKE '%shemer%' THEN 'customer_email:shemer' END,
        CASE WHEN LOWER(COALESCE(o.customer_email, '')) LIKE '%asaf%' THEN 'customer_email:asaf' END,
        CASE WHEN LOWER(COALESCE(o.customer_email, '')) LIKE '%doh%' THEN 'customer_email:doh' END,
        CASE WHEN LOWER(COALESCE(o.customer_email, '')) LIKE '%sh50%' THEN 'customer_email:sh50' END,
        CASE WHEN LOWER(COALESCE(o.customer_email, '')) LIKE '%dohsh50%' THEN 'customer_email:dohsh50' END,
        CASE WHEN LOWER(COALESCE(o.product_name, '')) LIKE '%test%' THEN 'product_name:test' END,
        CASE WHEN LOWER(COALESCE(o.partner_location_name, '')) LIKE '%test%' THEN 'partner_location_name:test' END
      ], NULL) AS rules,
      LOWER(btrim(COALESCE(o.product_name, ''))) = 'test' AS product_is_exact_test,
      LOWER(btrim(COALESCE(o.partner_location_name, ''))) = 'test' AS partner_is_exact_test,
      LOWER(btrim(COALESCE(o.full_name, ''))) = 'test' AS name_is_exact_test
    FROM orders o
    WHERE LOWER(COALESCE(o.full_name, '')) LIKE '%shemer%'
       OR LOWER(COALESCE(o.full_name, '')) LIKE '%asaf%'
       OR COALESCE(o.full_name, '') LIKE '%שמר%'
       OR LOWER(COALESCE(o.customer_email, '')) LIKE '%shemer%'
       OR LOWER(COALESCE(o.customer_email, '')) LIKE '%asaf%'
       OR LOWER(COALESCE(o.customer_email, '')) LIKE '%doh%'
       OR LOWER(COALESCE(o.customer_email, '')) LIKE '%sh50%'
       OR LOWER(COALESCE(o.customer_email, '')) LIKE '%dohsh50%'
       OR LOWER(COALESCE(o.product_name, '')) LIKE '%test%'
       OR LOWER(COALESCE(o.partner_location_name, '')) LIKE '%test%'
    ORDER BY o.created_at ASC, o.order_id ASC
  `) as {
    order_id: string;
    created_at: string | Date;
    channel: string | null;
    order_status: string;
    price: string | number;
    rules: string[] | null;
    product_is_exact_test: boolean;
    partner_is_exact_test: boolean;
    name_is_exact_test: boolean;
  }[];

  for (const row of rows) {
    const wholeFieldTestFixture =
      row.product_is_exact_test || row.partner_is_exact_test || row.name_is_exact_test;
    console.log(
      JSON.stringify({
        order_id: row.order_id,
        created_at:
          row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        channel: row.channel,
        order_status: row.order_status,
        price: row.price,
        rules: row.rules,
        whole_field_test_fixture: wholeFieldTestFixture,
      }),
    );
  }
  console.log(`count=${rows.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "report failed");
  process.exit(1);
});
