/**
 * Idempotent: create plants table (008) and upsert rows from data/plants.json.
 * Maps legacy JSON `price` → supplier_price.
 *
 * Run: npm run db:migrate:plants
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

import { loadEnvLocal } from "./load-env-local.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const plantsFile = path.join(root, "data", "plants.json");
const migrationPath = path.join(root, "db", "migrations", "008_plants_table.sql");

function splitSqlStatements(sql) {
  const withoutComments = sql.replace(/--[^\n]*/g, "");
  return withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(BEGIN|COMMIT)$/i.test(s));
}

function parseOptionalNumber(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  return null;
}

function parseStringArray(value) {
  if (!Array.isArray(value)) return null;
  const items = value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

function normalizePlant(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Each plant must be a JSON object");
  }
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) throw new Error("Plant id is required");

  const supplierPrice =
    parseOptionalNumber(raw.supplier_price) ??
    parseOptionalNumber(raw.supplierPrice) ??
    parseOptionalNumber(raw.price);
  if (supplierPrice === null) {
    throw new Error(`Plant ${id}: supplier price must be a non-negative number`);
  }

  const images = parseStringArray(raw.images);
  const labels = parseStringArray(raw.labels);
  const careInstructions = parseStringArray(raw.careInstructions);
  if (!images) throw new Error(`Plant ${id}: images required`);
  if (!labels) throw new Error(`Plant ${id}: labels required`);
  if (!careInstructions) throw new Error(`Plant ${id}: careInstructions required`);

  const currency = typeof raw.currency === "string" ? raw.currency.trim() : "";
  const difficulty = typeof raw.difficulty === "string" ? raw.difficulty.trim() : "";
  const light = typeof raw.light === "string" ? raw.light.trim() : "";

  return {
    id,
    name: typeof raw.name === "string" ? raw.name.trim() : "",
    family: typeof raw.family === "string" && raw.family.trim() ? raw.family.trim() : null,
    subtitle: typeof raw.subtitle === "string" ? raw.subtitle.trim() : "",
    description: typeof raw.description === "string" ? raw.description.trim() : "",
    supplierPrice,
    currency,
    images,
    labels,
    light,
    water: typeof raw.water === "string" ? raw.water.trim() : "",
    averageSize:
      typeof raw.averageSize === "string" && raw.averageSize.trim()
        ? raw.averageSize.trim()
        : null,
    supplierName:
      typeof raw.supplierName === "string" && raw.supplierName.trim()
        ? raw.supplierName.trim()
        : null,
    difficulty,
    location: typeof raw.location === "string" ? raw.location.trim() : "",
    petFriendly: raw.petFriendly === true,
    careInstructions,
    createdAt:
      typeof raw.createdAt === "string" && raw.createdAt.trim()
        ? raw.createdAt.trim()
        : null,
  };
}

await loadEnvLocal();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.local (see .env.example).");
  process.exit(1);
}

const sql = neon(url);
const migrationSql = await readFile(migrationPath, "utf-8");
const statements = splitSqlStatements(migrationSql);

console.log(`Applying ${statements.length} statement(s) from 008_plants_table.sql ...`);
for (const statement of statements) {
  const preview = statement.split("\n")[0].slice(0, 72);
  process.stdout.write(`  • ${preview}...\n`);
  await sql.query(statement, []);
}

const raw = await readFile(plantsFile, "utf-8");
const parsed = JSON.parse(raw);
if (!Array.isArray(parsed)) {
  throw new Error("plants.json must be a JSON array");
}

let count = 0;
for (const item of parsed) {
  const plant = normalizePlant(item);
  const imagesJson = JSON.stringify(plant.images);
  const labelsJson = JSON.stringify(plant.labels);
  const careJson = JSON.stringify(plant.careInstructions);

  await sql`
    INSERT INTO plants (
      id, name, family, subtitle, description, supplier_price, currency,
      images, labels, light, water, average_size,
      supplier_name, difficulty, location, pet_friendly,
      care_instructions, created_at
    )
    VALUES (
      ${plant.id},
      ${plant.name},
      ${plant.family},
      ${plant.subtitle},
      ${plant.description},
      ${plant.supplierPrice},
      ${plant.currency},
      ${imagesJson}::jsonb,
      ${labelsJson}::jsonb,
      ${plant.light},
      ${plant.water},
      ${plant.averageSize},
      ${plant.supplierName},
      ${plant.difficulty},
      ${plant.location},
      ${plant.petFriendly},
      ${careJson}::jsonb,
      ${plant.createdAt}::timestamptz
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      family = EXCLUDED.family,
      subtitle = EXCLUDED.subtitle,
      description = EXCLUDED.description,
      supplier_price = EXCLUDED.supplier_price,
      currency = EXCLUDED.currency,
      images = EXCLUDED.images,
      labels = EXCLUDED.labels,
      light = EXCLUDED.light,
      water = EXCLUDED.water,
      average_size = EXCLUDED.average_size,
      supplier_name = EXCLUDED.supplier_name,
      difficulty = EXCLUDED.difficulty,
      location = EXCLUDED.location,
      pet_friendly = EXCLUDED.pet_friendly,
      care_instructions = EXCLUDED.care_instructions,
      created_at = COALESCE(plants.created_at, EXCLUDED.created_at)
  `;
  count += 1;
}

const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM plants`;
console.log(`Migrated ${count} plant(s) from plants.json. Table now has ${n} row(s).`);
