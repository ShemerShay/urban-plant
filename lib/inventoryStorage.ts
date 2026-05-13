/**
 * Partner shelf state (prototype JSON): whether a plant unit at a location is still for sale.
 * Used for product-page availability and post-checkout updates — there is no separate admin view.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import type { InventoryRecord } from "./inventoryTypes";
import type { InventoryStatus } from "./status";

const INVENTORY_FILE = path.join(process.cwd(), "data", "inventory.json");

function normalizeRecord(entry: unknown): InventoryRecord | null {
  if (!entry || typeof entry !== "object") return null;
  const o = entry as Record<string, unknown>;
  const plantId = typeof o.plantId === "string" ? o.plantId.trim() : "";
  const locationId = typeof o.locationId === "string" ? o.locationId.trim() : "";
  let status: InventoryStatus = "available";
  if (o.status === "sold") status = "sold";
  else if (o.status === "available") status = "available";

  if (!plantId || !locationId) return null;
  return { plantId, locationId, status };
}

export async function readInventory(): Promise<InventoryRecord[]> {
  try {
    const raw = await readFile(INVENTORY_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeRecord(item))
      .filter((x): x is InventoryRecord => x !== null);
  } catch {
    return [];
  }
}

export async function saveInventory(records: InventoryRecord[]): Promise<void> {
  await mkdir(path.dirname(INVENTORY_FILE), { recursive: true });
  await writeFile(INVENTORY_FILE, `${JSON.stringify(records, null, 2)}\n`, "utf-8");
}

/**
 * Shelf status for plant + partner location (product page badge).
 * No row → treat as not listed as available → show as sold for display.
 */
export async function getInventoryDisplayStatus(
  plantId: string,
  locationId: string | null | undefined,
): Promise<InventoryStatus | null> {
  if (!locationId?.trim()) return null;
  const rows = await readInventory();
  const row = rows.find((r) => r.plantId === plantId && r.locationId === locationId.trim());
  return row?.status ?? "sold";
}

export async function markInventorySold(plantId: string, locationId: string | null): Promise<void> {
  if (!locationId?.trim()) return;
  const loc = locationId.trim();
  const rows = await readInventory();
  const idx = rows.findIndex((r) => r.plantId === plantId && r.locationId === loc);
  if (idx === -1) {
    rows.push({ plantId, locationId: loc, status: "sold" });
  } else {
    rows[idx] = { ...rows[idx], status: "sold" };
  }
  await saveInventory(rows);
}

/** Mark shelf unit buyable again (admin released order back to available). */
export async function markInventoryAvailable(plantId: string, locationId: string | null): Promise<void> {
  if (!locationId?.trim()) return;
  const loc = locationId.trim();
  const rows = await readInventory();
  const idx = rows.findIndex((r) => r.plantId === plantId && r.locationId === loc);
  if (idx === -1) {
    rows.push({ plantId, locationId: loc, status: "available" });
  } else {
    rows[idx] = { ...rows[idx], status: "available" };
  }
  await saveInventory(rows);
}
