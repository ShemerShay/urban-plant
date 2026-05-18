/**
 * Local JSON order management is only for prototype/testing and should be replaced
 * with a real database before production.
 */

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { createPendingOrder } from "@/lib/createPendingOrder";
import { appendEvent } from "@/lib/eventStorage";
import type { ActivityEvent } from "@/lib/eventTypes";
import {
  logOrderFlowEnd,
  logOrderFlowSection,
  logOrderFlowStart,
} from "@/lib/logOrderFlow";
import { getLocationById, resolveLocationFields } from "@/lib/mockLocations";
import { isValidEmail, isValidPhone } from "@/lib/formValidation";
import { getPlantById } from "@/lib/mockPlants";
import { getOfferById } from "@/lib/offerStorage";
import type { Offer } from "@/lib/offerTypes";
import type { FulfillmentMethod, OrderSnapshot, SavedOrder } from "@/lib/orderTypes";
import { appendOrder } from "@/lib/ordersStorage";
import { getPosSpotBySpotSlug, setPosSpotStatus } from "@/lib/posSpotStorage";
import type { PosSpot } from "@/lib/posSpotTypes";
import type { OrderStatus } from "@/lib/status";
import type { PlantProduct } from "@/lib/types";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

function parsePrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function buildSnapshot(input: {
  plant: PlantProduct;
  offer: Offer;
  posSpot?: PosSpot;
  fulfillmentMethod: FulfillmentMethod;
}): Promise<OrderSnapshot> {
  const { plant, offer, posSpot, fulfillmentMethod } = input;
  const partner = posSpot ? await getLocationById(posSpot.partnerLocationId) : undefined;
  return {
    productId: plant.id,
    productName: plant.name,
    ...(plant.family ? { productFamily: plant.family } : {}),
    ...(plant.images[0] ? { productImage: plant.images[0] } : {}),
    productDescription: plant.description,
    offerId: offer.id,
    consumerPrice: offer.consumerPrice,
    ...(typeof offer.supplierPrice === "number" ? { supplierPrice: offer.supplierPrice } : {}),
    ...(offer.supplierName ? { supplierName: offer.supplierName } : {}),
    ...(posSpot ? { partnerLocationId: posSpot.partnerLocationId } : {}),
    ...(partner ? { partnerLocationName: partner.name } : {}),
    ...(posSpot ? { posSpotId: posSpot.id, posSpotDescription: posSpot.spotDescription } : {}),
    ...(posSpot ? { spotSlug: posSpot.spotSlug } : {}),
    fulfillmentType: fulfillmentMethod,
    care: {
      light: plant.light,
      wateringDays: plant.water,
      ...(plant.averageSize ? { averageSize: plant.averageSize } : {}),
      ...(plant.maintenanceConditions
        ? { maintenanceConditions: plant.maintenanceConditions }
        : {}),
      careInstructions: plant.careInstructions,
    },
  };
}

function buildOrderCreatedEvent(order: SavedOrder): ActivityEvent {
  return {
    id: randomUUID(),
    type: "order_created",
    ...(order.posSpotId ? { posSpotId: order.posSpotId } : {}),
    ...(order.offerId ? { offerId: order.offerId } : {}),
    orderId: order.orderId,
    productId: order.plantId,
    ...(order.locationId ? { partnerLocationId: order.locationId } : {}),
    createdAt: order.createdAt,
    createdBy: order.source ?? "online",
    data: {
      fulfillmentMethod: order.fulfillmentMethod,
      orderStatus: order.orderStatus,
    },
  };
}

async function appendOrderCreatedEvent(order: SavedOrder): Promise<ActivityEvent> {
  const event = buildOrderCreatedEvent(order);
  await appendEvent(event);
  return event;
}

function logOnlineOrderFlow(input: {
  requestPayload: Record<string, unknown>;
  posSpot: PosSpot;
  offer: Offer;
  product: PlantProduct;
  checkoutSessionDraft: ReturnType<typeof createPendingOrder> | null;
  orderBeforeSave: SavedOrder;
  snapshot: OrderSnapshot;
  orderAfterSave: SavedOrder;
  updatedPosSpot?: PosSpot;
  orderCreatedEvent: ActivityEvent;
}): void {
  logOrderFlowStart({
    flow: "online_checkout",
    orderId: input.orderBeforeSave.orderId,
    spotSlug: input.posSpot?.spotSlug ?? null,
  });
  logOrderFlowSection("CHECKOUT REQUEST PAYLOAD", input.requestPayload);
  logOrderFlowSection("POS SPOT (resolved from spotSlug)", input.posSpot);
  logOrderFlowSection("currentOfferId", input.posSpot.currentOfferId);
  logOrderFlowSection("OFFER", input.offer);
  logOrderFlowSection("PRODUCT", input.product);
  logOrderFlowSection(
    "CHECKOUT SESSION",
    input.checkoutSessionDraft ?? {
      note: "Not persisted yet — current flow completes the order directly without payment session storage.",
    },
  );
  logOrderFlowSection("ORDER SNAPSHOT", input.snapshot);
  logOrderFlowSection("FINAL ORDER (before save)", input.orderBeforeSave);
  logOrderFlowSection("FINAL ORDER (after save)", input.orderAfterSave);
  logOrderFlowSection("UPDATED POS SPOT (after sold)", input.updatedPosSpot);
  logOrderFlowSection("order_created EVENT", input.orderCreatedEvent);
  logOrderFlowEnd();
}

async function completedOrder(input: {
  orderId: string;
  plant: PlantProduct;
  offer: Offer;
  posSpot?: PosSpot;
  fullName: string;
  customerEmail?: string;
  phone: string;
  address: string;
  apartmentOrNotes: string;
  fulfillmentMethod: FulfillmentMethod;
  createdAt: string;
  source: "online" | "manual" | "admin";
}): Promise<SavedOrder> {
  const partner = input.posSpot ? await getLocationById(input.posSpot.partnerLocationId) : undefined;
  const orderStatus: OrderStatus =
    input.fulfillmentMethod === "pickup" ? "picked_up" : "sold";
  return {
    id: input.orderId,
    orderId: input.orderId,
    ...(input.posSpot ? { posSpotId: input.posSpot.id } : {}),
    offerId: input.offer.id,
    plantId: input.plant.id,
    plantName: input.plant.name,
    locationId: input.posSpot?.partnerLocationId ?? null,
    locationName: partner?.name ?? null,
    locationAddress: partner?.address ?? null,
    price: input.offer.consumerPrice,
    fullName: input.fullName,
    ...(input.customerEmail ? { customerEmail: input.customerEmail } : {}),
    phone: input.phone,
    address: input.address,
    apartmentOrNotes: input.apartmentOrNotes,
    fulfillmentMethod: input.fulfillmentMethod,
    createdAt: input.createdAt,
    orderStatus,
    source: input.source,
    snapshot: await buildSnapshot({
      plant: input.plant,
      offer: input.offer,
      posSpot: input.posSpot,
      fulfillmentMethod: input.fulfillmentMethod,
    }),
    ...(orderStatus === "picked_up" ? { pickedUpAt: input.createdAt } : {}),
  };
}

/**
 * Manual admin entry (no client orderId): creates a completed sale row for testing.
 */
async function postLegacyManualOrder(record: Record<string, unknown>): Promise<Response> {
  const {
    plantId,
    locationId: locationIdRaw,
    fullName,
    phone,
    address,
    apartmentOrNotes,
    fulfillmentMethod: fulfillmentMethodRaw,
    plantName,
    price,
  } = record;

  const nameStr = typeof fullName === "string" ? fullName.trim() : "";
  const phoneStr = typeof phone === "string" ? phone.trim() : "";
  const addressStr = typeof address === "string" ? address.trim() : "";
  const fulfillmentMethod: FulfillmentMethod =
    fulfillmentMethodRaw === "pickup" ? "pickup" : "delivery";
  const orderStatus: OrderStatus =
    fulfillmentMethod === "pickup" ? "picked_up" : "sold";

  if (!nameStr) {
    return NextResponse.json({ error: "fullName is required" }, { status: 400 });
  }
  if (fulfillmentMethod === "delivery" && !phoneStr) {
    return NextResponse.json({ error: "phone is required" }, { status: 400 });
  }
  if (fulfillmentMethod === "delivery" && !addressStr) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  const notesStr =
    typeof apartmentOrNotes === "string" ? apartmentOrNotes.trim() : "";

  let locationInput: string | null | undefined;
  if (locationIdRaw === null) {
    locationInput = null;
  } else if (typeof locationIdRaw === "string") {
    locationInput = locationIdRaw;
  } else {
    locationInput = undefined;
  }

  const {
    locationId: resolvedLocationId,
    locationName: resolvedLocationName,
    locationAddress: resolvedLocationAddress,
  } = await resolveLocationFields(
    locationInput === undefined ? undefined : locationInput,
  );

  const catalogId = typeof plantId === "string" ? plantId.trim() : "";
  const catalogPlant = catalogId ? getPlantById(catalogId) : undefined;

  let resolvedPlantId: string;
  let resolvedPlantName: string;
  let resolvedPrice: number;

  if (catalogPlant) {
    resolvedPlantId = catalogPlant.id;
    resolvedPlantName = catalogPlant.name;
    const customPrice = parsePrice(price);
    resolvedPrice =
      customPrice !== null && customPrice >= 0 ? customPrice : catalogPlant.price;
  } else {
    const manualName = typeof plantName === "string" ? plantName.trim() : "";
    const manualPrice = parsePrice(price);
    if (!manualName) {
      return NextResponse.json(
        { error: "plantId must match a catalog plant, or plantName is required" },
        { status: 400 },
      );
    }
    if (manualPrice === null || manualPrice < 0) {
      return NextResponse.json(
        { error: "price is required and must be a non-negative number" },
        { status: 400 },
      );
    }
    resolvedPlantId = "manual";
    resolvedPlantName = manualName;
    resolvedPrice = manualPrice;
  }

  const createdAt = new Date().toISOString();
  const orderId = randomUUID();
  const manualOffer: Offer = {
    id: "manual-offer",
    productId: resolvedPlantId,
    consumerPrice: resolvedPrice,
    status: "active",
    createdAt,
  };
  const order: SavedOrder = {
    id: orderId,
    orderId,
    offerId: manualOffer.id,
    plantId: resolvedPlantId,
    plantName: resolvedPlantName,
    locationId: resolvedLocationId,
    locationName: resolvedLocationName,
    locationAddress: resolvedLocationAddress,
    price: resolvedPrice,
    fullName: nameStr,
    phone: phoneStr,
    address: addressStr,
    apartmentOrNotes: notesStr,
    fulfillmentMethod,
    createdAt,
    orderStatus,
    source: "admin",
    ...(orderStatus === "picked_up" ? { pickedUpAt: createdAt } : {}),
  };

  await appendOrder(order);
  const orderCreatedEvent = await appendOrderCreatedEvent(order);
  logOrderFlowStart({ flow: "legacy_manual_admin", orderId: order.orderId });
  logOrderFlowSection("FINAL ORDER (manual admin)", order);
  logOrderFlowSection("order_created EVENT", orderCreatedEvent);
  logOrderFlowEnd();

  return NextResponse.json({ ok: true, orderId: order.orderId });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;

  if (
    typeof record.plantName === "string" &&
    record.price !== undefined &&
    record.orderId === undefined
  ) {
    return postLegacyManualOrder(record);
  }

  const {
    orderId: orderIdRaw,
    plantId,
    fullName,
    phone,
    address,
    apartmentOrNotes,
    fulfillmentMethod: fulfillmentMethodRaw,
    customerEmail: customerEmailRaw,
    spotSlug: spotSlugRaw,
  } = record;

  const orderId = typeof orderIdRaw === "string" ? orderIdRaw.trim() : "";
  if (!orderId || !isUuid(orderId)) {
    return NextResponse.json({ error: "orderId must be a valid UUID" }, { status: 400 });
  }

  const nameStr = typeof fullName === "string" ? fullName.trim() : "";
  const emailTrim =
    typeof customerEmailRaw === "string" ? customerEmailRaw.trim().toLowerCase() : "";
  if (!emailTrim || !isValidEmail(emailTrim)) {
    return NextResponse.json(
      { error: "customerEmail is required and must be a valid email" },
      { status: 400 },
    );
  }

  const phoneStr = typeof phone === "string" ? phone.trim() : "";
  const addressStr = typeof address === "string" ? address.trim() : "";
  const fulfillmentMethod = fulfillmentMethodRaw === "pickup" ? "pickup" : "delivery";

  if (!nameStr) {
    return NextResponse.json({ error: "fullName is required" }, { status: 400 });
  }
  if (!phoneStr) {
    return NextResponse.json({ error: "phone is required" }, { status: 400 });
  }
  if (!isValidPhone(phoneStr)) {
    return NextResponse.json({ error: "phone must be a valid phone number" }, { status: 400 });
  }
  if (fulfillmentMethod === "delivery" && !addressStr) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  const notesStr =
    typeof apartmentOrNotes === "string" ? apartmentOrNotes.trim() : "";

  const spotSlug = typeof spotSlugRaw === "string" ? spotSlugRaw.trim() : "";
  if (!spotSlug) {
    return NextResponse.json({ error: "spotSlug is required" }, { status: 400 });
  }

  const catalogId = typeof plantId === "string" ? plantId.trim() : "";
  const catalogPlant = catalogId ? getPlantById(catalogId) : undefined;

  if (!catalogPlant) {
    return NextResponse.json({ error: "plantId must match a catalog plant" }, { status: 400 });
  }

  if (catalogPlant.status === "sold") {
    return NextResponse.json(
      { error: "This plant is no longer available for purchase." },
      { status: 400 },
    );
  }

  const posSpot = await getPosSpotBySpotSlug(spotSlug);
  if (!posSpot) {
    return NextResponse.json({ error: "POS Spot not found" }, { status: 404 });
  }

  const offer = await getOfferById(posSpot.currentOfferId);
  if (!offer || offer.status !== "active") {
    return NextResponse.json({ error: "Offer is not available" }, { status: 400 });
  }
  if (offer.productId !== catalogPlant.id) {
    return NextResponse.json({ error: "Offer does not match selected product" }, { status: 400 });
  }
  if (posSpot.status !== "available") {
    return NextResponse.json(
      { error: "This POS Spot is no longer available for purchase." },
      { status: 400 },
    );
  }

  const createdAt = new Date().toISOString();
  const partner = await getLocationById(posSpot.partnerLocationId);
  const order = await completedOrder({
    orderId,
    plant: catalogPlant,
    offer,
    posSpot,
    fullName: nameStr,
    customerEmail: emailTrim,
    phone: phoneStr,
    address: fulfillmentMethod === "delivery" ? addressStr : "",
    apartmentOrNotes: fulfillmentMethod === "delivery" ? notesStr : "",
    fulfillmentMethod,
    createdAt,
    source: "online",
  });
  const snapshot = order.snapshot!;
  const checkoutSessionDraft = createPendingOrder({
    orderId,
    plantId: catalogPlant.id,
    plantName: catalogPlant.name,
    amount: offer.consumerPrice,
    customerName: nameStr,
    customerEmail: emailTrim,
    fulfillmentMethod,
    phone: phoneStr,
    address: fulfillmentMethod === "delivery" ? addressStr : "",
    apartmentOrNotes: fulfillmentMethod === "delivery" ? notesStr : "",
    locationId: posSpot.partnerLocationId,
    locationName: partner?.name ?? null,
    locationAddress: partner?.address ?? null,
  });

  await appendOrder(order);
  const updatedPosSpot = await setPosSpotStatus(posSpot.id, "sold");
  const orderCreatedEvent = await appendOrderCreatedEvent(order);

  logOnlineOrderFlow({
    requestPayload: {
      orderId,
      plantId: catalogId,
      spotSlug,
      fulfillmentMethod,
      fullName: nameStr,
      customerEmail: emailTrim,
      phone: phoneStr,
      address: fulfillmentMethod === "delivery" ? addressStr : "",
      apartmentOrNotes: fulfillmentMethod === "delivery" ? notesStr : "",
    },
    posSpot,
    offer,
    product: catalogPlant,
    checkoutSessionDraft,
    orderBeforeSave: order,
    snapshot,
    orderAfterSave: order,
    updatedPosSpot: updatedPosSpot ?? posSpot,
    orderCreatedEvent,
  });

  // TODO(payment): move this completed order creation to provider confirmation/webhook.

  return NextResponse.json({ ok: true, orderId: order.orderId });
}
