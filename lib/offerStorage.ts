/**
 * Reusable sale offers (prototype JSON). Product/Offer creation is manual source data for now.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { mockPlants } from "./mockPlants";
import type { Offer, OfferStatus } from "./offerTypes";

const OFFERS_FILE = path.join(process.cwd(), "data", "offers.json");
const SEED_CREATED_AT = "2026-05-17T00:00:00.000Z";

export function defaultOfferIdForProduct(productId: string): string {
  return `offer-${productId}`;
}

function defaultOffers(): Offer[] {
  return mockPlants.map((plant) => ({
    id: defaultOfferIdForProduct(plant.id),
    productId: plant.id,
    consumerPrice: plant.price,
    ...(typeof plant.baseSupplierPrice === "number"
      ? { supplierPrice: plant.baseSupplierPrice }
      : {}),
    ...(plant.supplierName ? { supplierName: plant.supplierName } : {}),
    status: plant.status === "sold" ? "inactive" : "active",
    createdAt: plant.createdAt ?? SEED_CREATED_AT,
  }));
}

function normalizeOffer(entry: unknown): Offer | null {
  if (!entry || typeof entry !== "object") return null;
  const o = entry as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const productId = typeof o.productId === "string" ? o.productId.trim() : "";
  const consumerPrice =
    typeof o.consumerPrice === "number" && Number.isFinite(o.consumerPrice)
      ? o.consumerPrice
      : null;
  const status: OfferStatus = o.status === "inactive" ? "inactive" : "active";
  const createdAt = typeof o.createdAt === "string" && o.createdAt ? o.createdAt : SEED_CREATED_AT;
  const supplierPrice =
    typeof o.supplierPrice === "number" && Number.isFinite(o.supplierPrice)
      ? o.supplierPrice
      : undefined;
  const supplierName =
    typeof o.supplierName === "string" && o.supplierName.trim()
      ? o.supplierName.trim()
      : undefined;

  if (!id || !productId || consumerPrice === null) return null;
  return {
    id,
    productId,
    consumerPrice,
    ...(supplierPrice !== undefined ? { supplierPrice } : {}),
    ...(supplierName ? { supplierName } : {}),
    status,
    createdAt,
  };
}

export async function readOffers(): Promise<Offer[]> {
  try {
    const raw = await readFile(OFFERS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaultOffers();
    const offers = parsed
      .map((item) => normalizeOffer(item))
      .filter((x): x is Offer => x !== null);
    return offers.length > 0 ? offers : defaultOffers();
  } catch {
    return defaultOffers();
  }
}

export async function saveOffers(offers: Offer[]): Promise<void> {
  await mkdir(path.dirname(OFFERS_FILE), { recursive: true });
  await writeFile(OFFERS_FILE, `${JSON.stringify(offers, null, 2)}\n`, "utf-8");
}

export async function getOfferById(id: string): Promise<Offer | undefined> {
  const offers = await readOffers();
  return offers.find((offer) => offer.id === id);
}
