/**
 * Apply a single SQL file (split on `;`, skip BEGIN/COMMIT-only segments).
 * Usage: node scripts/apply-sql-file.mjs db/migrations/002_pos_spot_pos_name.sql
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

import { loadEnvLocal } from "./load-env-local.mjs";

function splitSqlStatements(sql) {
  const withoutComments = sql.replace(/--[^\n]*/g, "");
  return withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(BEGIN|COMMIT)$/i.test(s));
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = process.argv[2];
if (!rel) {
  console.error("Usage: node scripts/apply-sql-file.mjs <path-to.sql>");
  process.exit(1);
}

const migrationPath = path.isAbsolute(rel) ? rel : path.join(root, rel);
await loadEnvLocal();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.local (see .env.example).");
  process.exit(1);
}

const sql = neon(url);
const migrationSql = await readFile(migrationPath, "utf-8");
const statements = splitSqlStatements(migrationSql);

console.log(`Applying ${statements.length} statement(s) from ${path.relative(root, migrationPath)} ...`);

for (const statement of statements) {
  const preview = statement.split("\n")[0].slice(0, 72);
  process.stdout.write(`  • ${preview}...\n`);
  await sql.query(statement, []);
}

console.log("Done.");
