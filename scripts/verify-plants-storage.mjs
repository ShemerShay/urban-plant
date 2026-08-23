/**
 * Smoke-test plants table CRUD (requires DATABASE_URL in .env.local).
 * Run: npm run db:verify-plants
 */
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvLocal } from "./load-env-local.mjs";

await loadEnvLocal();

const stubServerOnlyUrl = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "stubs", "server-only.mjs"),
).href;

// lib/db uses `import "server-only"` for Next.js bundling. Stub it so this
// Node script can import plantStorage without changing application code.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: stubServerOnlyUrl };
    }
    return nextResolve(specifier, context);
  },
});

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

const withHe = await updatePlant(testId, {
  ...updated,
  nameHe: "שם בדיקה",
});
if (
  !withHe ||
  withHe.name !== "Verify Plant Updated" ||
  withHe.subtitle !== updated.subtitle ||
  withHe.description !== updated.description ||
  withHe.water !== updated.water ||
  withHe.nameHe !== "שם בדיקה"
) {
  console.error("FAIL: Hebrew save changed English or did not persist", withHe);
  process.exit(1);
}
console.log("OK: Hebrew save left English fields unchanged");

const { localizedPlantText } = await import("../lib/plantDisplay.ts");
const { localizedFieldFromBody } = await import("../lib/plantValidation.ts");
if (localizedPlantText("he", "Fiddle Leaf Fig", undefined) !== "Fiddle Leaf Fig") {
  console.error("FAIL: missing Hebrew should fall back to English");
  process.exit(1);
}
if (localizedPlantText("he", "Fiddle Leaf Fig", "פיקוס כינורי מדיום") !== "פיקוס כינורי מדיום") {
  console.error("FAIL: Hebrew locale should use non-empty Hebrew");
  process.exit(1);
}
if (localizedPlantText("en", "Fiddle Leaf Fig", "פיקוס כינורי מדיום") !== "Fiddle Leaf Fig") {
  console.error("FAIL: English locale should keep English");
  process.exit(1);
}
if (localizedFieldFromBody({}, "דרצנה", "nameHe", "name_he") !== "דרצנה") {
  console.error("FAIL: omitted Hebrew field must keep existing value");
  process.exit(1);
}
if (localizedFieldFromBody({ nameHe: "" }, "דרצנה", "nameHe", "name_he") !== undefined) {
  console.error("FAIL: empty Hebrew field should clear");
  process.exit(1);
}
console.log("OK: localizedPlantText fallback");

const { sql } = await import("../lib/db.ts");
await sql`DELETE FROM plants WHERE id = ${testId}`;
const gone = await getPlantByIdAsync(testId);
if (gone) {
  console.error("FAIL: test plant still exists after delete");
  process.exit(1);
}
console.log("OK: cleanup test row");

console.log("\nAll plant storage checks passed.");
