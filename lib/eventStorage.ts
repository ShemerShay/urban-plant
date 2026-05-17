/**
 * Activity log records for POS Spots and Orders (prototype JSON).
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import type { ActivityEvent, ActivityEventType } from "./eventTypes";

const EVENTS_FILE = path.join(process.cwd(), "data", "events.json");

function normalizeType(value: unknown): ActivityEventType | null {
  if (
    value === "order_created" ||
    value === "order_cancelled" ||
    value === "manual_status_update" ||
    value === "plant_placed"
  ) {
    return value;
  }
  return null;
}

function normalizeEvent(entry: unknown): ActivityEvent | null {
  if (!entry || typeof entry !== "object") return null;
  const o = entry as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const type = normalizeType(o.type);
  const createdAt = typeof o.createdAt === "string" && o.createdAt ? o.createdAt : null;
  if (!id || !type || !createdAt) return null;

  const event: ActivityEvent = { id, type, createdAt };
  for (const key of ["posSpotId", "offerId", "orderId", "productId", "partnerLocationId", "createdBy"] as const) {
    const value = o[key];
    if (typeof value === "string" && value.trim()) event[key] = value.trim();
  }
  if (o.data && typeof o.data === "object" && !Array.isArray(o.data)) {
    event.data = o.data as Record<string, unknown>;
  }
  return event;
}

export async function readEvents(): Promise<ActivityEvent[]> {
  try {
    const raw = await readFile(EVENTS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeEvent(item))
      .filter((x): x is ActivityEvent => x !== null);
  } catch {
    return [];
  }
}

export async function saveEvents(events: ActivityEvent[]): Promise<void> {
  await mkdir(path.dirname(EVENTS_FILE), { recursive: true });
  await writeFile(EVENTS_FILE, `${JSON.stringify(events, null, 2)}\n`, "utf-8");
}

export async function appendEvent(event: ActivityEvent): Promise<void> {
  const events = await readEvents();
  events.push(event);
  await saveEvents(events);
}
