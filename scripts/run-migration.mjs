/**
 * Apply db/migrations/001_initial_schema.sql to Neon.
 * Run: npm run db:migrate
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

import { loadEnvLocal } from "./load-env-local.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = path.join(root, "db", "migrations", "001_initial_schema.sql");

function splitSqlStatements(sql) {
  const withoutComments = sql.replace(/--[^\n]*/g, "");
  return withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(BEGIN|COMMIT)$/i.test(s));
}

await loadEnvLocal();
const sql = neon(process.env.DATABASE_URL);
const migrationSql = await readFile(migrationPath, "utf-8");
const statements = splitSqlStatements(migrationSql);

console.log(`Applying ${statements.length} statement(s) from 001_initial_schema.sql ...`);

for (const statement of statements) {
  const preview = statement.split("\n")[0].slice(0, 72);
  process.stdout.write(`  • ${preview}...\n`);
  await sql.query(statement, []);
}

console.log("Migration complete.");
