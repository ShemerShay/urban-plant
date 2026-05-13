/**
 * Local JSON order management is only for prototype/testing and should be replaced
 * with a real database before production.
 */

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { markInventorySold } from "@/lib/inventoryStorage";
import { resolveLocationFields } from "@/lib/mockLocations";
import { getPlantById } from "@/lib/mockPlants";
import { appendOrder } from "@/lib/ordersStorage";
import type { FulfillmentMethod, SavedOrder } from "@/lib/orderTypes";
import type { OrderStatus } from "@/lib/status";

function parsePrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
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
  } = body as Record<string, unknown>;

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
  } = resolveLocationFields(
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
    resolvedPrice = catalogPlant.price;
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
  const order: SavedOrder = {
    orderId: randomUUID(),
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
    ...(orderStatus === "picked_up" ? { pickedUpAt: createdAt } : {}),
  };

  await appendOrder(order);
  await markInventorySold(resolvedPlantId, resolvedLocationId);

  return NextResponse.json({ ok: true, orderId: order.orderId });
}
