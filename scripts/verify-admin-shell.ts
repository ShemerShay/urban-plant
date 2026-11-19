import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const nav = readFileSync(join(root, "lib/adminNav.ts"), "utf8");
const shell = readFileSync(join(root, "components/admin/AdminShell.tsx"), "utf8");
const adminIndex = readFileSync(join(root, "app/admin/page.tsx"), "utf8");
const messages = readFileSync(join(root, "lib/messages.ts"), "utf8");

for (const route of ["analytics", "orders", "inventoryTypes", "offers", "partners"]) {
  assert.match(nav, new RegExp(`routes\\.admin\\.${route}\\(\\)`));
}

for (const key of ["label", "open", "close", "catalog", "partnersPos"]) {
  assert.equal(messages.match(new RegExp(`"admin\\.nav\\.${key}"`, "g"))?.length, 2);
}

assert.match(adminIndex, /redirect\(routes\.admin\.analytics\(\)\)/);
assert.match(shell, /event\.key === "Escape"/);
assert.match(shell, /aria-modal="true"/);
assert.match(shell, /aria-current=\{active \? "page"/);
assert.match(shell, /document\.body\.style\.overflow = "hidden"/);

console.log("OK: admin shell navigation");
