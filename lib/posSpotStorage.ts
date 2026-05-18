/**
 * POS Spots are the stable physical QR anchors. Local availability lives here.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import type { MaintenanceStatus, PosSpot, PosSpotStatus } from "./posSpotTypes";

const POS_SPOTS_FILE = path.join(process.cwd(), "data", "pos-spots.json");
const SEED_CREATED_AT = "2026-05-17T00:00:00.000Z";

function slugPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function posSpotSlugPart(value: string): string {
  return slugPart(value);
}

export function defaultPosSpotId(partnerLocationId: string, productId: string): string {
  return `pos-${slugPart(partnerLocationId)}-${slugPart(productId)}`;
}

export function defaultSpotSlug(partnerLocationId: string, productId: string): string {
  return `${slugPart(partnerLocationId)}-${slugPart(productId)}`;
}

function normalizeMaintenanceStatus(value: unknown): MaintenanceStatus | undefined {
  if (value === "checked" || value === "needs_watering" || value === "needs_treatment") {
    return value;
  }
  return undefined;
}

function normalizeStatus(value: unknown): PosSpotStatus {
  if (value === "sold" || value === "inactive") return value;
  return "available";
}

function normalizePosSpot(entry: unknown): PosSpot | null {
  if (!entry || typeof entry !== "object") return null;
  const o = entry as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const partnerLocationId =
    typeof o.partnerLocationId === "string" ? o.partnerLocationId.trim() : "";
  const spotSlug =
    typeof o.spotSlug === "string" && o.spotSlug.trim()
      ? o.spotSlug.trim()
      : typeof o.qrSlug === "string"
        ? o.qrSlug.trim()
        : "";
  const currentOfferId = typeof o.currentOfferId === "string" ? o.currentOfferId.trim() : "";
  const spotDescription =
    typeof o.spotDescription === "string" && o.spotDescription.trim()
      ? o.spotDescription.trim()
      : "Display spot";
  const createdAt = typeof o.createdAt === "string" && o.createdAt ? o.createdAt : SEED_CREATED_AT;

  if (!id || !partnerLocationId || !spotSlug || !currentOfferId) return null;

  const posNumber =
    typeof o.posNumber === "string" && o.posNumber.trim() ? o.posNumber.trim() : undefined;
  const placementNotes =
    typeof o.placementNotes === "string" && o.placementNotes.trim()
      ? o.placementNotes.trim()
      : undefined;
  const placedAt =
    typeof o.placedAt === "string" && o.placedAt ? o.placedAt : undefined;
  const latestMaintenanceStatus = normalizeMaintenanceStatus(o.latestMaintenanceStatus);
  const lastCheckedAt =
    typeof o.lastCheckedAt === "string" && o.lastCheckedAt ? o.lastCheckedAt : undefined;
  const lastWateredAt =
    typeof o.lastWateredAt === "string" && o.lastWateredAt ? o.lastWateredAt : undefined;
  const lastHandledAt =
    typeof o.lastHandledAt === "string" && o.lastHandledAt ? o.lastHandledAt : undefined;
  const lastHandledBy =
    typeof o.lastHandledBy === "string" && o.lastHandledBy.trim()
      ? o.lastHandledBy.trim()
      : undefined;

  return {
    id,
    partnerLocationId,
    ...(posNumber ? { posNumber } : {}),
    spotDescription,
    ...(placementNotes ? { placementNotes } : {}),
    spotSlug,
    currentOfferId,
    status: normalizeStatus(o.status),
    ...(placedAt ? { placedAt } : {}),
    ...(latestMaintenanceStatus ? { latestMaintenanceStatus } : {}),
    ...(lastCheckedAt ? { lastCheckedAt } : {}),
    ...(lastWateredAt ? { lastWateredAt } : {}),
    ...(lastHandledAt ? { lastHandledAt } : {}),
    ...(lastHandledBy ? { lastHandledBy } : {}),
    createdAt,
  };
}

export async function readPosSpots(): Promise<PosSpot[]> {
  try {
    const raw = await readFile(POS_SPOTS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizePosSpot(item))
      .filter((x): x is PosSpot => x !== null);
  } catch {
    return [];
  }
}

export async function savePosSpots(spots: PosSpot[]): Promise<void> {
  await mkdir(path.dirname(POS_SPOTS_FILE), { recursive: true });
  await writeFile(POS_SPOTS_FILE, `${JSON.stringify(spots, null, 2)}\n`, "utf-8");
}

export async function getPosSpotById(id: string): Promise<PosSpot | undefined> {
  const spots = await readPosSpots();
  return spots.find((spot) => spot.id === id);
}

export async function getPosSpotBySpotSlug(spotSlug: string): Promise<PosSpot | undefined> {
  const trimmed = spotSlug.trim();
  const spots = await readPosSpots();
  return spots.find((spot) => spot.spotSlug === trimmed || spot.id === trimmed);
}

export async function setPosSpotStatus(id: string, status: PosSpotStatus): Promise<PosSpot | null> {
  const spots = await readPosSpots();
  const idx = spots.findIndex((spot) => spot.id === id);
  if (idx === -1) return null;
  const updated = { ...spots[idx], status };
  spots[idx] = updated;
  await savePosSpots(spots);
  return updated;
}

export async function appendPosSpot(posSpot: PosSpot): Promise<PosSpot> {
  const spots = await readPosSpots();
  if (spots.some((spot) => spot.id === posSpot.id || spot.spotSlug === posSpot.spotSlug)) {
    throw new Error("POS Spot id or spot slug already exists");
  }
  spots.push(posSpot);
  await savePosSpots(spots);
  return posSpot;
}
