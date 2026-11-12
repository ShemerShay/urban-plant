/**
 * One-time Base44 finance CSV import.
 * Refuses to run without a file. Does not copy orders.
 *
 * Usage: npx tsx scripts/import-finance-base44.ts path/to.csv
 * Partner names are resolved only through data/finance/base44-partner-aliases.json
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

async function main(): Promise<void> {
  const filePath = process.argv[2]?.trim();
  if (!filePath) {
    console.error("Pass the Base44 CSV path. Nothing was imported.");
    process.exitCode = 1;
    return;
  }
  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();
  const {
    base44InvestmentTotalsMatch,
    parseBase44Csv,
  } = await import("../lib/finance/base44Csv");
  const { importBase44Entries } = await import("../lib/finance/storage");
  const csv = await readFile(path.resolve(filePath), "utf8");
  const parsed = parseBase44Csv(csv);
  if (!parsed.ok) {
    console.error(parsed.errors.join("\n"));
    process.exitCode = 1;
    return;
  }
  if (!base44InvestmentTotalsMatch(parsed.rows)) {
    console.error("Inventory purchase totals do not match the Base44 control figures.");
    process.exitCode = 1;
    return;
  }
  const aliasPath = path.join(process.cwd(), "data", "finance", "base44-partner-aliases.json");
  let partnerIdsByName: Record<string, string> = {};
  const needsAlias = parsed.rows.some((row) => row.partnerName);
  if (needsAlias) {
    try {
      partnerIdsByName = JSON.parse(await readFile(aliasPath, "utf8")) as Record<string, string>;
    } catch {
      console.error(`Missing partner alias file: ${aliasPath}`);
      process.exitCode = 1;
      return;
    }
  }
  const result = await importBase44Entries({ rows: parsed.rows, partnerIdsByName });
  console.log(`Imported ${result.inserted} rows. Skipped ${result.skipped} existing keys.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
