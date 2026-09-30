/**
 * Plant occupancy on a durable POS / QR slot.
 * Offer is commercial config. Variant is physical SKU identity.
 * Does not write central inventory. Does not create Placement Cycle/Segment rows.
 */

import { inventoryTypeOrDefault, type InventoryType } from "@/lib/inventoryType";
import { getOfferById } from "@/lib/offerStorage";
import { MANUAL_OFFER_ID, MANUAL_PRODUCT_ID, isPosAssignableOffer, type Offer } from "@/lib/offerTypes";
import { getPlantById } from "@/lib/plantCatalog";
import { getPlantVariantById, type PlantVariant } from "@/lib/plantVariantStorage";
import { isPosSpotPurchasable } from "@/lib/posSpotHold";
import type { PosSpot, PosSpotStatus } from "@/lib/posSpotTypes";

export const OCCUPANCY_INTENTS = [
  "place",
  "update",
  "replace",
  "remove",
  "assign_variant",
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
  updateOfferPlacedAt?: true;
  offerPlacedAt?: string | null;
  updateStatus?: true;
  status?: PosSpotStatus;
} {
  return {
    ...(patch.updatePlantVariantId ? { plantVariantId: patch.plantVariantId } : {}),
    ...(patch.updateCurrentOfferId ? { currentOfferId: patch.currentOfferId } : {}),
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

export function isLegacyPlantAssignment(
  spot: Pick<PosSpot, "plantVariantId" | "currentOfferId" | "status">,
  inventoryType: InventoryType | null,
): boolean {
  if (hasPlantOccupancy(spot)) return false;
  if (!posHasCommerceOffer(spot)) return false;
  if (inventoryType !== "plants") return false;
  return spot.status !== "sold";
}

export function canPlacePlantOnPos(
  spot: Pick<PosSpot, "plantVariantId" | "currentOfferId" | "status">,
  currentOfferInventoryType: InventoryType | null,
): boolean {
  if (hasPlantOccupancy(spot)) return false;
  if (isLegacyPlantAssignment(spot, currentOfferInventoryType)) return false;
  return true;
}

export function offerCompatibleWithVariant(
  offer: Pick<Offer, "productId" | "variantId">,
  variant: Pick<PlantVariant, "id" | "plantId">,
): boolean {
  if (offer.productId !== variant.plantId) return false;
  if (offer.variantId && offer.variantId !== variant.id) return false;
  return true;
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
  updateOfferPlacedAt: boolean;
  offerPlacedAt: string | null;
  forceAvailable: boolean;
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
    updateOfferPlacedAt: false,
    offerPlacedAt: null,
    forceAvailable: false,
  };
}

function assertOfferUsableOnPos(offer: Offer, previousOfferId: string | undefined): void {
  if (offer.id === MANUAL_OFFER_ID || offer.productId === MANUAL_PRODUCT_ID) {
    throw new PosOccupancyError("Manual offers cannot be used on POS spots");
  }
  if (offer.status !== "active" && offer.id !== (previousOfferId ?? "")) {
    throw new PosOccupancyError("When changing the offer, choose an active offer.");
  }
  if (!isPosAssignableOffer(offer) && offer.id !== (previousOfferId ?? "")) {
    throw new PosOccupancyError(
      "Active catalog offer required (manual offers cannot be used on POS spots)",
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

async function loadVariantOrThrow(variantId: string): Promise<PlantVariant> {
  const variant = await getPlantVariantById(variantId);
  if (!variant) {
    throw new PosOccupancyError("Variant not found");
  }
  return variant;
}

export type ResolveOccupancyInput = {
  existing: PosSpot;
  occupancyIntent?: OccupancyIntent | null;
  /** Undefined = not sent. Null/empty = clear (Remove). */
  requestedOfferId?: string | null;
  requestedVariantId?: string | null;
  sameVariantReplace?: boolean;
  requestedStatus?: PosSpotStatus | null;
};

async function existingOfferInventoryType(existing: PosSpot): Promise<InventoryType | null> {
  if (!existing.currentOfferId) return null;
  const offer = await getOfferById(existing.currentOfferId);
  if (!offer) return null;
  const plant = await getPlantById(offer.productId);
  return plant ? inventoryTypeOrDefault(plant.inventoryType) : null;
}

function requirePlantVariantAndOffer(args: {
  variantId: string | null | undefined;
  offerId: string | null | undefined;
  action: "Place" | "Replace";
}): { variantId: string; offerId: string } {
  const variantId = args.variantId?.trim() || "";
  const offerId = args.offerId?.trim() || "";
  if (!variantId) {
    throw new PosOccupancyError(`${args.action} requires a known plant variant`);
  }
  if (!offerId) {
    throw new PosOccupancyError(`${args.action} requires a compatible offer`);
  }
  return { variantId, offerId };
}

async function placePatch(
  existing: PosSpot,
  currentType: InventoryType | null,
  variantId: string,
  offerId: string,
): Promise<OccupancyFieldPatch> {
  if (!canPlacePlantOnPos(existing, currentType)) {
    throw new PosOccupancyError("Place is not allowed on an occupied POS");
  }
  const variant = await loadVariantOrThrow(variantId);
  const { offer, inventoryType } = await loadOfferContext(offerId);
  if (inventoryType === "flowers") {
    throw new PosOccupancyError("Flowers are outside plant occupancy");
  }
  assertOfferUsableOnPos(offer, undefined);
  if (!offerCompatibleWithVariant(offer, variant)) {
    throw new PosOccupancyError("Offer is not compatible with the selected variant");
  }
  return {
    action: "place",
    updatePlantVariantId: true,
    plantVariantId: variant.id,
    updateCurrentOfferId: true,
    currentOfferId: offer.id,
    updateOfferPlacedAt: true,
    offerPlacedAt: occupancyTimestamp(),
    forceAvailable: true,
  };
}

async function replacePatch(variantId: string, offerId: string): Promise<OccupancyFieldPatch> {
  const variant = await loadVariantOrThrow(variantId);
  const { offer, inventoryType } = await loadOfferContext(offerId);
  if (inventoryType === "flowers") {
    throw new PosOccupancyError("Flowers are outside plant occupancy");
  }
  assertOfferUsableOnPos(offer, undefined);
  if (!offerCompatibleWithVariant(offer, variant)) {
    throw new PosOccupancyError("Offer is not compatible with the selected variant");
  }
  return {
    action: "replace",
    updatePlantVariantId: true,
    plantVariantId: variant.id,
    updateCurrentOfferId: true,
    currentOfferId: offer.id,
    updateOfferPlacedAt: true,
    offerPlacedAt: occupancyTimestamp(),
    forceAvailable: false,
  };
}

async function assignVariantPatch(
  existing: PosSpot,
  variantId: string,
  offerId: string,
): Promise<OccupancyFieldPatch> {
  if (hasPlantOccupancy(existing)) {
    throw new PosOccupancyError("Variant is already assigned; use Replace to change the unit");
  }
  const variant = await loadVariantOrThrow(variantId);
  const { offer, inventoryType } = await loadOfferContext(offerId);
  if (inventoryType === "flowers") {
    throw new PosOccupancyError("Flowers are outside plant occupancy");
  }
  assertOfferUsableOnPos(offer, existing.currentOfferId);
  if (!offerCompatibleWithVariant(offer, variant)) {
    throw new PosOccupancyError("Offer is not compatible with the selected variant");
  }
  const offerChanged = offer.id !== (existing.currentOfferId ?? "");
  return {
    action: "assign_variant",
    updatePlantVariantId: true,
    plantVariantId: variant.id,
    updateCurrentOfferId: offerChanged,
    currentOfferId: offer.id,
    updateOfferPlacedAt: false,
    offerPlacedAt: null,
    forceAvailable: false,
  };
}

function removePatch(): OccupancyFieldPatch {
  return {
    action: "remove",
    updatePlantVariantId: true,
    plantVariantId: null,
    updateCurrentOfferId: true,
    currentOfferId: null,
    updateOfferPlacedAt: true,
    offerPlacedAt: null,
    forceAvailable: false,
  };
}

async function updateSameUnitPatch(
  existing: PosSpot,
  nextOfferId: string,
): Promise<OccupancyFieldPatch> {
  const { offer, inventoryType } = await loadOfferContext(nextOfferId);
  assertOfferUsableOnPos(offer, existing.currentOfferId);
  const occupyingVariantId = existing.plantVariantId?.trim() || "";

  if (inventoryType === "flowers") {
    return {
      action: "update",
      updatePlantVariantId: occupyingVariantId ? true : false,
      plantVariantId: null,
      updateCurrentOfferId: true,
      currentOfferId: offer.id,
      updateOfferPlacedAt: false,
      offerPlacedAt: null,
      forceAvailable: false,
    };
  }

  if (occupyingVariantId) {
    const variant = await loadVariantOrThrow(occupyingVariantId);
    if (!offerCompatibleWithVariant(offer, variant)) {
      throw new PosOccupancyError("Variant change uses Replace");
    }
  }

  const offerChanged = offer.id !== (existing.currentOfferId ?? "");
  return {
    action: "update",
    updatePlantVariantId: false,
    plantVariantId: occupyingVariantId || null,
    updateCurrentOfferId: offerChanged,
    currentOfferId: offer.id,
    updateOfferPlacedAt: false,
    offerPlacedAt: null,
    forceAvailable: false,
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

function nextVariantId(
  existing: PosSpot,
  requestedVariantId: string | null | undefined,
  offer: Offer | null,
): string | null {
  if (requestedVariantId !== undefined) {
    const trimmed = requestedVariantId?.trim() || "";
    return trimmed || null;
  }
  if (offer?.variantId?.trim()) return offer.variantId.trim();
  return existing.plantVariantId?.trim() || null;
}

/**
 * Map an admin PATCH onto Place / Update / Replace / Remove / assign_variant / deactivate.
 * Ask for explicit Replace only when the same variant is a new physical unit.
 */
export async function resolveOccupancyForPosPatch(
  input: ResolveOccupancyInput,
): Promise<OccupancyFieldPatch> {
  const existing = input.existing;
  const currentType = await existingOfferInventoryType(existing);
  const intent = input.occupancyIntent ?? null;
  const offerId = nextOfferId(existing, input.requestedOfferId);

  if (intent === "remove") {
    return removePatch();
  }

  if (intent === "assign_variant") {
    const variantId = input.requestedVariantId?.trim() || "";
    if (!variantId || !offerId) {
      throw new PosOccupancyError("Assigning a variant requires a known variant and offer");
    }
    return assignVariantPatch(existing, variantId, offerId);
  }

  if (intent === "place") {
    const ids = requirePlantVariantAndOffer({
      variantId: input.requestedVariantId ?? (await offerVariantHint(offerId)),
      offerId,
      action: "Place",
    });
    return placePatch(existing, currentType, ids.variantId, ids.offerId);
  }

  if (intent === "replace" || input.sameVariantReplace) {
    const ids = requirePlantVariantAndOffer({
      variantId:
        input.requestedVariantId ??
        existing.plantVariantId ??
        (await offerVariantHint(offerId)),
      offerId,
      action: "Replace",
    });
    return replacePatch(ids.variantId, ids.offerId);
  }

  if (intent === "update") {
    if (!offerId) {
      throw new PosOccupancyError("Update requires an offer");
    }
    return updateSameUnitPatch(existing, offerId);
  }

  if (intent === "deactivate") {
    return unchangedOccupancy("deactivate");
  }

  // Auto-map when the operator did not send an occupancy intent.
  const requestedVariantExplicit = input.requestedVariantId !== undefined;
  const loadedOffer = offerId ? await getOfferById(offerId) : undefined;
  const inferredVariantId = nextVariantId(existing, input.requestedVariantId, loadedOffer ?? null);
  const existingVariantId = existing.plantVariantId?.trim() || "";

  if (!offerId) {
    if (posHasCommerceOffer(existing) || hasPlantOccupancy(existing)) {
      return removePatch();
    }
    return unchangedOccupancy("update");
  }

  const { offer, inventoryType } = await loadOfferContext(offerId);

  if (inventoryType === "flowers") {
    if (hasPlantOccupancy(existing) || offer.id !== (existing.currentOfferId ?? "")) {
      return {
        action: "update",
        updatePlantVariantId: hasPlantOccupancy(existing),
        plantVariantId: null,
        updateCurrentOfferId: offer.id !== (existing.currentOfferId ?? ""),
        currentOfferId: offer.id,
        updateOfferPlacedAt: false,
        offerPlacedAt: null,
        forceAvailable: false,
      };
    }
    return unchangedOccupancy("update");
  }

  if (!existingVariantId && inferredVariantId && isLegacyPlantAssignment(existing, currentType)) {
    return assignVariantPatch(existing, inferredVariantId, offer.id);
  }

  if (canPlacePlantOnPos(existing, currentType)) {
    if (!inferredVariantId) {
      throw new PosOccupancyError("Place requires a known plant variant");
    }
    return placePatch(existing, currentType, inferredVariantId, offer.id);
  }

  if (existingVariantId && inferredVariantId && inferredVariantId !== existingVariantId) {
    return replacePatch(inferredVariantId, offer.id);
  }

  if (
    existingVariantId &&
    inferredVariantId === existingVariantId &&
    requestedVariantExplicit &&
    input.sameVariantReplace
  ) {
    return replacePatch(inferredVariantId, offer.id);
  }

  return updateSameUnitPatch(existing, offer.id);
}

async function offerVariantHint(offerId: string | null): Promise<string | undefined> {
  if (!offerId) return undefined;
  const offer = await getOfferById(offerId);
  return offer?.variantId?.trim() || undefined;
}

export async function resolveOccupancyForPosCreate(input: {
  offerId: string;
  plantVariantId?: string | null;
}): Promise<OccupancyFieldPatch> {
  const { offer, inventoryType } = await loadOfferContext(input.offerId);
  assertOfferUsableOnPos(offer, undefined);
  if (inventoryType === "flowers") {
    if (input.plantVariantId?.trim()) {
      throw new PosOccupancyError("Flowers are outside plant occupancy");
    }
    return {
      action: "update",
      updatePlantVariantId: true,
      plantVariantId: null,
      updateCurrentOfferId: true,
      currentOfferId: offer.id,
      updateOfferPlacedAt: true,
      offerPlacedAt: occupancyTimestamp(),
      forceAvailable: false,
    };
  }

  const variantId = input.plantVariantId?.trim() || offer.variantId?.trim() || "";
  if (!variantId) {
    throw new PosOccupancyError("Place requires a known plant variant");
  }
  const variant = await loadVariantOrThrow(variantId);
  if (!offerCompatibleWithVariant(offer, variant)) {
    throw new PosOccupancyError("Offer is not compatible with the selected variant");
  }
  return {
    action: "place",
    updatePlantVariantId: true,
    plantVariantId: variant.id,
    updateCurrentOfferId: true,
    currentOfferId: offer.id,
    updateOfferPlacedAt: true,
    offerPlacedAt: occupancyTimestamp(),
    forceAvailable: true,
  };
}
