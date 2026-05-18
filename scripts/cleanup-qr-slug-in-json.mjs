/**
 * One-time: rename qrSlug → spotSlug in data/*.json (does not run at app runtime).
 * Run: npm run db:cleanup-qr-slug
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");

function visit(value, pathParts, changes) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, [...pathParts, String(index)], changes));
    return;
  }
  if (!value || typeof value !== "object") return;

  if (Object.prototype.hasOwnProperty.call(value, "qrSlug")) {
    if (Object.prototype.hasOwnProperty.call(value, "spotSlug")) {
      throw new Error(
        `${pathParts.join(".")}: has both qrSlug and spotSlug — resolve manually before seeding`,
      );
    }
    value.spotSlug = value.qrSlug;
    delete value.qrSlug;
    changes.push(pathParts.join("."));
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "qrSlug" || key === "qr_slug") {
      throw new Error(`${pathParts.join(".")}: unexpected qrSlug key "${key}"`);
    }
    visit(child, [...pathParts, key], changes);
  }
}

let filesTouched = 0;
let keysRenamed = 0;

const entries = await readdir(dataDir, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

  const filePath = path.join(dataDir, entry.name);
  const raw = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  const changes = [];
  visit(parsed, [entry.name], changes);

  if (changes.length === 0) continue;

  await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
  filesTouched += 1;
  keysRenamed += changes.length;
  console.log(`${entry.name}: renamed qrSlug → spotSlug at ${changes.join(", ")}`);
}

if (filesTouched === 0) {
  console.log("No qrSlug keys found in data/*.json — nothing to change.");
} else {
  console.log(`Done. Updated ${filesTouched} file(s), ${keysRenamed} key(s).`);
}
