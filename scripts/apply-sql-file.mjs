/**
 * Apply a single SQL file (split on `;`, skip BEGIN/COMMIT-only segments).
 * Usage: node scripts/apply-sql-file.mjs db/migrations/002_pos_spot_pos_name.sql
 *
 * The statement scanner is quote-aware so dollar-quoted function bodies stay
 * one statement. BEGIN and COMMIT are still skipped.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { neon } from "@neondatabase/serverless";

import { loadEnvLocal } from "./load-env-local.mjs";

const DOLLAR_QUOTE = /^\$[A-Za-z0-9_]*\$/;

function openingDollarQuote(sql, index) {
  if (sql[index] !== "$") return null;
  const match = DOLLAR_QUOTE.exec(sql.slice(index));
  return match ? match[0] : null;
}

function consumeSingleQuoted(sql, index) {
  let i = index + 1;
  while (i < sql.length) {
    if (sql[i] === "'") {
      if (sql[i + 1] === "'") {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return sql.length;
}

function consumeDollarQuoted(sql, index) {
  const tag = openingDollarQuote(sql, index);
  if (!tag) return null;
  const close = sql.indexOf(tag, index + tag.length);
  if (close === -1) return sql.length;
  return close + tag.length;
}

/** Drops `--` line comments only outside single quotes and dollar quotes. */
export function stripSqlLineComments(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const dollarEnd = consumeDollarQuoted(sql, i);
    if (dollarEnd != null) {
      out += sql.slice(i, dollarEnd);
      i = dollarEnd;
      continue;
    }
    if (sql[i] === "'") {
      const end = consumeSingleQuoted(sql, i);
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    if (sql[i] === "-" && sql[i + 1] === "-") {
      i += 2;
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

/** Previous scanner: strip every `--` comment, then split on every semicolon. */
export function splitSqlStatementsLegacy(sql) {
  const withoutComments = sql.replace(/--[^\n]*/g, "");
  return withoutComments
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !/^(BEGIN|COMMIT)$/i.test(statement));
}

/**
 * Splits on semicolons only outside single quotes, `''` escapes, `$$`, and `$tag$`.
 * `--` comments are removed only outside those quotes. BEGIN and COMMIT are skipped.
 */
export function splitSqlStatements(sql) {
  const source = stripSqlLineComments(sql);
  const parts = [];
  let current = "";
  let i = 0;
  while (i < source.length) {
    const dollarEnd = consumeDollarQuoted(source, i);
    if (dollarEnd != null) {
      current += source.slice(i, dollarEnd);
      i = dollarEnd;
      continue;
    }
    if (source[i] === "'") {
      const end = consumeSingleQuoted(source, i);
      current += source.slice(i, end);
      i = end;
      continue;
    }
    if (source[i] === ";") {
      parts.push(current);
      current = "";
      i += 1;
      continue;
    }
    current += source[i];
    i += 1;
  }
  if (current.length > 0) parts.push(current);
  return parts
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !/^(BEGIN|COMMIT)$/i.test(statement));
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

async function main() {
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
}

if (isDirectRun()) {
  await main();
}
