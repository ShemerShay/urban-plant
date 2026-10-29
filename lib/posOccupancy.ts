/**
 * Plant occupancy on a durable POS / QR slot.
 * Offer is commercial config. Plant Size is derived from the Offer’s Sellable Variant.
 * Does not write central inventory. Does not create Placement Cycle/Segment rows.
 */

import { getOfferById } from "@/lib/offerStorage";
import {
  MANUAL_OFFER_ID,
  MANUAL_PRODUCT_ID,
  isPlantPosEligibleOffer,
  isPosAssignableOffer,
  type Offer,
} from "@/lib/offerTypes";
import { getPlantById } from "@/lib/plantCatalog";
import { inventoryTypeOrDefault, type InventoryType } from "@/lib/inventoryType";
import { isPosSpotPurchasable } from "@/lib/posSpotHold";
import type { PosSpot, PosSpotStatus } from "@/lib/posSpotTypes";

export const OCCUPANCY_INTENTS = [
  "place",
  "update",
  "replace",
  "remove",
  "deactivate",
] as const;

export type OccupancyIntent = (typeof OCCUPANCY_INTENTS)[number];

export function parseOccupancyIntent(value: unknown): OccupancyIntent | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return (OCCUPANCY_INTENTS as readonly string[]).includes(trimmed)
    ? (trimmed as OccupancyIntent)
    : null;
}

export function occupancyToSpotFields(patch: OccupancyFieldPatch): {
  plantVariantId?: string | null;
  currentOfferId?: string | null;
  potId?: string | null;
  updateOfferPlacedAt?: true;
  offerPlacedAt?: string | null;
  updateStatus?: true;
  status?: PosSpotStatus;
} {
  return {
    ...(patch.updatePlantVariantId ? { plantVariantId: patch.plantVariantId } : {}),
    ...(patch.updateCurrentOfferId ? { currentOfferId: patch.currentOfferId } : {}),
    ...(patch.updatePotColorId ? { potId: patch.potId } : {}),
    ...(patch.updateOfferPlacedAt
      ? { updateOfferPlacedAt: true as const, offerPlacedAt: patch.offerPlacedAt }
      : {}),
    ...(patch.forceAvailable ? { updateStatus: true as const, status: "available" as const } : {}),
  };
}

export class PosOccupancyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PosOccupancyError";
  }
}

export function hasPlantOccupancy(spot: Pick<PosSpot, "plantVariantId">): boolean {
  return Boolean(spot.plantVariantId?.trim());
}

export function posHasCommerceOffer(spot: Pick<PosSpot, "currentOfferId">): boolean {
  return Boolean(spot.currentOfferId?.trim());
}

/**
 * Valid POS whose plant occupancy was removed (or never placed): no variant, no offer.
 * Sold leftover offers are not empty. Unknown slugs are a different case.
 */
export function isEmptyPosOccupancy(
  spot: Pick<PosSpot, "status" | "plantVariantId" | "currentOfferId">,
): boolean {
  if (spot.status === "sold") return false;
  return !hasPlantOccupancy(spot) && !posHasCommerceOffer(spot);
}

export function canPlacePlantOnPos(spot: Pick<PosSpot, "plantVariantId">): boolean {
  return !hasPlantOccupancy(spot);
}

/**
 * Empty/removed plant POS cannot start payment. Flowers and legacy plant offers can.
 * Status gates remain in `isPosSpotPurchasable`.
 */
export function posAllowsNewCustomerPurchase(
  spot: Pick<PosSpot, "status" | "currentOfferId">,
  options?: { resumeHolder?: boolean },
): boolean {
  if (!isPosSpotPurchasable(spot.status, options)) return false;
  return posHasCommerceOffer(spot);
}

export type OccupancyFieldPatch = {
  action: OccupancyIntent;
  updatePlantVariantId: boolean;
  plantVariantId: string | null;
  updateCurrentOfferId: boolean;
  currentOfferId: string | null;
  updatePotColorId: boolean;
  potId: string | null;
  updateOfferPlacedAt: boolean;
  offerPlacedAt: string | null;
  forceAvailable: boolean;
  introducesNewPotColor: boolean;
};

function occupancyTimestamp(): string {
  return new Date().toISOString();
}

function unchangedOccupancy(action: OccupancyIntent): OccupancyFieldPatch {
  return {
    action,
    updatePlantVariantId: false,
    plantVariantId: null,
    updateCurrentOfferId: false,
    currentOfferId: null,
    updatePotColorId: false,
    potId: null,
    updateOfferPlacedAt: false,
    offerPlacedAt: null,
    forceAvailable: false,
    introducesNewPotColor: false,
  };
}

function flowerPatch(input: {
  occupyingVariantId: string;
  offerId: string;
  offerChanged: boolean;
}): OccupancyFieldPatch {
  return {
    action: "update",
    updatePlantVariantId: Boolean(input.occupyingVariantId),
    plantVariantId: null,
    updateCurrentOfferId: input.offerChanged,
    currentOfferId: input.offerId,
    updatePotColorId: Boolean(input.occupyingVariantId),
    potId: null,
    updateOfferPlacedAt: false,
    offerPlacedAt: null,
    forceAvailable: false,
    introducesNewPotColor: false,
  };
}

function assertNotManual(offer: Offer): void {
  if (offer.id === MANUAL_OFFER_ID || offer.productId === MANUAL_PRODUCT_ID) {
    throw new PosOccupancyError("Manual offers cannot be used on POS spots");
  }
}

function assertPlantOfferEligibleForWrite(
  offer: Offer,
  partnerLocationId: string,
  previousOfferId: string | undefined,
): void {
  assertNotManual(offer);
  if (offer.id === (previousOfferId ?? "")) return;
  if (!isPlantPosEligibleOffer(offer, partnerLocationId)) {
    throw new PosOccupancyError(
      "Choose an active Offer that is available at this Partner Location",
    );
  }
}

async function loadOfferContext(offerId: string): Promise<{
  offer: Offer;
  inventoryType: InventoryType;
}> {
  const offer = await getOfferById(offerId);
  if (!offer) {
    throw new PosOccupancyError("Offer not found");
  }
  const plant = await getPlantById(offer.productId);
  if (!plant) {
    throw new PosOccupancyError("Catalog product not found for offer");
  }
  return { offer, inventoryType: inventoryTypeOrDefault(plant.inventoryType) };
}

async function resolvePlantOccupancyIds(input: {
  offer: Offer;
  partnerLocationId: string;
  previousOfferId?: string;
}): Promise<{ plantVariantId: string; potId: string | null }> {
  assertPlantOfferEligibleForWrite(input.offer, input.partnerLocationId, input.previousOfferId);
  const sellable = input.offer.sellableVariant;
  if (!input.offer.sellableVariantId || !sellable?.plantSizeId) {
    throw new PosOccupancyError("Place requires a variant-backed Offer");
  }
  return {
    plantVariantId: sellable.plantSizeId,
    potId: sellable.potId?.trim() || null,
  };
}

function introducingNewColor(
  existingColorId: string | null | undefined,
  nextColorId: string | null,
): boolean {
  const existing = existingColorId?.trim() || "";
  const next = nextColorId?.trim() || "";
  return Boolean(next) && next !== existing;
}

async function placePatch(
  existing: PosSpot,
  offerId: string,
  partnerLocationId: string,
  requestedPotColorId: string | null | undefined,
): Promise<OccupancyFieldPatch> {
  if (!canPlacePlantOnPos(existing)) {
    throw new PosOccupancyError("Place is not allowed on an occupied POS");
  }
  const { offer, inventoryType } = await loadOfferContext(offerId);
  if (inventoryType === "flowers") {
    throw new PosOccupancyError("Flowers are outside plant occupancy");
  }
  const ids = await resolvePlantOccupancyIds({
    offer,
    partnerLocationId,
  });
  return {
    action: "place",
    updatePlantVariantId: true,
    plantVariantId: ids.plantVariantId,
    updateCurrentOfferId: true,
    currentOfferId: offer.id,
    updatePotColorId: true,
    potId: ids.potId,
    updateOfferPlacedAt: true,
    offerPlacedAt: occupancyTimestamp(),
    forceAvailable: true,
    introducesNewPotColor: introducingNewColor(null, ids.potId),
  };
}

async function replacePatch(
  offerId: string,
  partnerLocationId: string,
  requestedPotColorId: string | null | undefined,
  existing: PosSpot,
): Promise<OccupancyFieldPatch> {
  const { offer, inventoryType } = await loadOfferContext(offerId);
  if (inventoryType === "flowers") {
    throw new PosOccupancyError("Flowers are outside plant occupancy");
  }
  const ids = await resolvePlantOccupancyIds({
    offer,
    partnerLocationId,
  });
  return {
    action: "replace",
    updatePlantVariantId: true,
    plantVariantId: ids.plantVariantId,
    updateCurrentOfferId: true,
    currentOfferId: offer.id,
    updatePotColorId: true,
    potId: ids.potId,
    updateOfferPlacedAt: true,
    offerPlacedAt: occupancyTimestamp(),
    forceAvailable: false,
    introducesNewPotColor: introducingNewColor(existing.potId, ids.potId),
  };
}

function removePatch(): OccupancyFieldPatch {
  return {
    action: "remove",
    updatePlantVariantId: true,
    plantVariantId: null,
    updateCurrentOfferId: true,
    currentOfferId: null,
    updatePotColorId: true,
    potId: null,
    updateOfferPlacedAt: true,
    offerPlacedAt: null,
    forceAvailable: false,
    introducesNewPotColor: false,
  };
}

async function updateSameUnitPatch(
  existing: PosSpot,
  nextOfferId: string,
  partnerLocationId: string,
  requestedPotColorId: string | null | undefined,
): Promise<OccupancyFieldPatch> {
  const { offer, inventoryType } = await loadOfferContext(nextOfferId);
  const occupyingVariantId = existing.plantVariantId?.trim() || "";

  if (inventoryType === "flowers") {
    assertNotManual(offer);
    if (offer.status !== "active" && offer.id !== (existing.currentOfferId ?? "")) {
      throw new PosOccupancyError("When changing the offer, choose an active offer.");
    }
    if (!isPosAssignableOffer(offer) && offer.id !== (existing.currentOfferId ?? "")) {
      throw new PosOccupancyError(
        "Active catalog offer required (manual offers cannot be used on POS spots)",
      );
    }
    return flowerPatch({
      occupyingVariantId,
      offerId: offer.id,
      offerChanged: offer.id !== (existing.currentOfferId ?? ""),
    });
  }

  if (!occupyingVariantId) {
    throw new PosOccupancyError("Update requires an occupying plant");
  }

  if (!offer.sellableVariantId || !offer.sellableVariant?.plantSizeId) {
    if (offer.id !== (existing.currentOfferId ?? "")) {
      throw new PosOccupancyError("Place requires a variant-backed Offer");
    }
    return {
      action: "update",
      updatePlantVariantId: false,
      plantVariantId: occupyingVariantId,
      updateCurrentOfferId: false,
      currentOfferId: offer.id,
      updatePotColorId: false,
      potId: existing.potId ?? null,
      updateOfferPlacedAt: false,
      offerPlacedAt: null,
      forceAvailable: false,
      introducesNewPotColor: false,
    };
  }

  const ids = await resolvePlantOccupancyIds({
    offer,
    partnerLocationId,
    previousOfferId: existing.currentOfferId,
  });
  if (ids.plantVariantId !== occupyingVariantId) {
    throw new PosOccupancyError("Variant change uses Replace");
  }

  const offerChanged = offer.id !== (existing.currentOfferId ?? "");
  const colorChanged = (ids.potId ?? "") !== (existing.potId?.trim() ?? "");
  return {
    action: "update",
    updatePlantVariantId: false,
    plantVariantId: occupyingVariantId,
    updateCurrentOfferId: offerChanged,
    currentOfferId: offer.id,
    updatePotColorId: colorChanged || offerChanged,
    potId: ids.potId,
    updateOfferPlacedAt: false,
    offerPlacedAt: null,
    forceAvailable: false,
    introducesNewPotColor: introducingNewColor(existing.potId, ids.potId),
  };
}

function nextOfferId(
  existing: PosSpot,
  requestedOfferId: string | null | undefined,
): string | null {
  if (requestedOfferId === undefined) return existing.currentOfferId ?? null;
  const trimmed = requestedOfferId?.trim() || "";
  return trimmed || null;
}

export type ResolveOccupancyInput = {
  existing: PosSpot;
  partnerLocationId?: string;
  occupancyIntent?: OccupancyIntent | null;
  /** Undefined = not sent. Null/empty = clear (Remove). */
  requestedOfferId?: string | null;
  requestedPotColorId?: string | null;
  sameVariantReplace?: boolean;
  requestedStatus?: PosSpotStatus | null;
};

/**
 * Map an admin PATCH onto Place / Update / Replace / Remove / deactivate.
 * Ask for explicit Replace only when the same Plant Size is a new physical unit.
 */
export async function resolveOccupancyForPosPatch(
  input: ResolveOccupancyInput,
): Promise<OccupancyFieldPatch> {
  const existing = input.existing;
  const partnerLocationId = input.partnerLocationId?.trim() || existing.partnerLocationId;
  const intent = input.occupancyIntent ?? null;
  const offerId = nextOfferId(existing, input.requestedOfferId);

  if (intent === "remove") {
    return removePatch();
  }

  if (intent === "place") {
    if (!offerId) {
      throw new PosOccupancyError("Place requires a compatible offer");
    }
    return placePatch(existing, offerId, partnerLocationId, input.requestedPotColorId);
  }

  if (intent === "replace" || input.sameVariantReplace) {
    if (!offerId) {
      throw new PosOccupancyError("Replace requires a compatible offer");
    }
    return replacePatch(offerId, partnerLocationId, input.requestedPotColorId, existing);
  }

  if (intent === "update") {
    if (!offerId) {
      throw new PosOccupancyError("Update requires an offer");
    }
    return updateSameUnitPatch(
      existing,
      offerId,
      partnerLocationId,
      input.requestedPotColorId,
    );
  }

  if (intent === "deactivate") {
    return unchangedOccupancy("deactivate");
  }

  if (!offerId) {
    if (posHasCommerceOffer(existing) || hasPlantOccupancy(existing)) {
      return removePatch();
    }
    return unchangedOccupancy("update");
  }

  const { offer, inventoryType } = await loadOfferContext(offerId);
  const existingVariantId = existing.plantVariantId?.trim() || "";

  if (inventoryType === "flowers") {
    if (hasPlantOccupancy(existing) || offer.id !== (existing.currentOfferId ?? "")) {
      return flowerPatch({
        occupyingVariantId: existingVariantId,
        offerId: offer.id,
        offerChanged: offer.id !== (existing.currentOfferId ?? ""),
      });
    }
    return unchangedOccupancy("update");
  }

  if (canPlacePlantOnPos(existing)) {
    return placePatch(existing, offer.id, partnerLocationId, input.requestedPotColorId);
  }

  const nextPlantSizeId = offer.sellableVariant?.plantSizeId?.trim() || "";
  if (existingVariantId && nextPlantSizeId && nextPlantSizeId !== existingVariantId) {
    return replacePatch(offer.id, partnerLocationId, input.requestedPotColorId, existing);
  }

  if (existingVariantId && nextPlantSizeId === existingVariantId && input.sameVariantReplace) {
    return replacePatch(offer.id, partnerLocationId, input.requestedPotColorId, existing);
  }

  return updateSameUnitPatch(
    existing,
    offer.id,
    partnerLocationId,
    input.requestedPotColorId,
  );
}

export async function resolveOccupancyForPosCreate(input: {
  offerId: string;
  partnerLocationId: string;
  potId?: string | null;
}): Promise<OccupancyFieldPatch> {
  const { offer, inventoryType } = await loadOfferContext(input.offerId);
  if (inventoryType === "flowers") {
    assertNotManual(offer);
    if (!isPosAssignableOffer(offer)) {
      throw new PosOccupancyError(
        "Active catalog offer required (manual offers cannot be used on POS spots)",
      );
    }
    return {
      action: "update",
      updatePlantVariantId: true,
      plantVariantId: null,
      updateCurrentOfferId: true,
      currentOfferId: offer.id,
      updatePotColorId: true,
      potId: null,
      updateOfferPlacedAt: true,
      offerPlacedAt: occupancyTimestamp(),
      forceAvailable: false,
      introducesNewPotColor: false,
    };
  }

  return placePatch(
    {
      plantVariantId: undefined,
      currentOfferId: undefined,
      potId: undefined,
      partnerLocationId: input.partnerLocationId,
      status: "available",
    } as PosSpot,
    input.offerId,
    input.partnerLocationId,
    input.potId,
  );
}
