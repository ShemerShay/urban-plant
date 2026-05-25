/**
 * Smoke-test plants table CRUD (requires DATABASE_URL in .env.local).
 * Run: node scripts/verify-plants-storage.mjs
 */
import { randomUUID } from "node:crypto";

import { loadEnvLocal } from "./load-env-local.mjs";

await loadEnvLocal();

const { createPlant, getPlantByIdAsync, readPlants, updatePlant } = await import(
  "../lib/plantStorage.ts"
);

const plants = await readPlants();
console.log(`OK: readPlants → ${plants.length} row(s)`);

const monstera = await getPlantByIdAsync("monstera");
if (!monstera || monstera.supplierPrice !== 89) {
  console.error("FAIL: monstera missing or wrong supplierPrice", monstera);
  process.exit(1);
}
console.log(`OK: getPlantByIdAsync(monstera) supplierPrice=${monstera.supplierPrice}`);

const testId = randomUUID();
const created = await createPlant({
  ...monstera,
  id: testId,
  name: "Verify Plant CRUD",
  createdAt: new Date().toISOString(),
});
if (created.supplierPrice !== monstera.supplierPrice) {
  console.error("FAIL: createPlant supplierPrice mismatch");
  process.exit(1);
}
console.log(`OK: createPlant ${testId}`);

const updated = await updatePlant(testId, {
  ...created,
  supplierPrice: 99,
  price: 99,
  name: "Verify Plant Updated",
});
if (!updated || updated.supplierPrice !== 99) {
  console.error("FAIL: updatePlant");
  process.exit(1);
}
console.log("OK: updatePlant");

const { sql } = await import("../lib/db.ts");
await sql`DELETE FROM plants WHERE id = ${testId}`;
const gone = await getPlantByIdAsync(testId);
if (gone) {
  console.error("FAIL: test plant still exists after delete");
  process.exit(1);
}
console.log("OK: cleanup test row");

console.log("\nAll plant storage checks passed.");
