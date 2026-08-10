/**
 * Admin-only: start a controlled Cardcom TEST LowProfile (terminal 1000).
 * Never accepts TerminalNumber / ApiName from the client.
 * Does not call Cardcom unless explicitly confirmed via confirmHold=true.
 */

import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/adminAuth";
import type { FulfillmentMethod } from "@/lib/orderTypes";
import { getOfferById } from "@/lib/offerStorage";
import { getPlantById } from "@/lib/plantCatalog";
import { getPosSpotBySpotSlug } from "@/lib/posSpotStorage";
import { isPosSpotPurchasable } from "@/lib/posSpotHold";
import { getPublicAppOrigin } from "@/lib/routes";
import { startCardcomPaymentPrep } from "@/lib/startCardcomPaymentPrep";

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const previewOnly = record.previewOnly === true;
  const confirmHold = record.confirmHold === true;

  const spotSlug = cleanString(record.spotSlug);
  const fulfillmentMethod: FulfillmentMethod =
    record.fulfillmentMethod === "pickup" ? "pickup" : "delivery";

  if (!spotSlug) {
    return NextResponse.json(
      { ok: false, error: "spotSlug is required" },
      { status: 400 },
    );
  }

  // Preview path: show what will be affected; no Cardcom call, no hold.
  if (previewOnly || !confirmHold) {
    try {
      getPublicAppOrigin();
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error:
            "APP_ORIGIN is missing or invalid. Set a public HTTPS origin (not localhost) before the test.",
        },
        { status: 500 },
      );
    }

    const posSpot = await getPosSpotBySpotSlug(spotSlug);
    if (!posSpot) {
      return NextResponse.json({ ok: false, error: "POS Spot not found" }, { status: 404 });
    }
    if (!isPosSpotPurchasable(posSpot.status)) {
      return NextResponse.json(
        {
          ok: false,
          error: `POS status is "${posSpot.status}" — need available.`,
          preview: {
            posSpotId: posSpot.id,
            spotSlug: posSpot.spotSlug,
            posStatus: posSpot.status,
          },
        },
        { status: 409 },
      );
    }

    const offer = await getOfferById(posSpot.currentOfferId);
    if (!offer || offer.status !== "active") {
      return NextResponse.json({ ok: false, error: "Offer is not available" }, { status: 400 });
    }
    const plant = await getPlantById(offer.productId);

    return NextResponse.json({
      ok: true,
      preview: true,
      environment: "test",
      terminalNumber: 1000,
      posSpotId: posSpot.id,
      spotSlug: posSpot.spotSlug,
      plantId: offer.productId,
      plantName: plant?.name ?? offer.productId,
      amount: offer.consumerPrice,
      fulfillmentMethod,
      warning:
        "Confirming will create a payment_attempt and set this POS to held_for_payment (owned by the attempt), then call Cardcom test LowProfile/Create (terminal 1000).",
      requiresConfirmHold: true,
    });
  }

  // Real test Create — only when confirmHold is explicitly true.
  try {
    getPublicAppOrigin();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error:
          "APP_ORIGIN is missing or invalid. Set a public HTTPS origin (not localhost) before the test.",
      },
      { status: 500 },
    );
  }

  if (!process.env.CARDCOM_TEST_API_NAME?.trim()) {
    return NextResponse.json(
      {
        ok: false,
        error: "CARDCOM_TEST_API_NAME is not set. Add the Cardcom test ApiName to .env.local.",
      },
      { status: 500 },
    );
  }

  const posSpot = await getPosSpotBySpotSlug(spotSlug);
  if (!posSpot) {
    return NextResponse.json({ ok: false, error: "POS Spot not found" }, { status: 404 });
  }
  const offer = await getOfferById(posSpot.currentOfferId);
  if (!offer || offer.status !== "active") {
    return NextResponse.json({ ok: false, error: "Offer is not available" }, { status: 400 });
  }

  const result = await startCardcomPaymentPrep(
    {
      plantId: offer.productId,
      spotSlug,
      fullName: cleanString(record.fullName) || "Cardcom Test",
      customerEmail: cleanString(record.customerEmail) || "cardcom-test@example.com",
      phone: cleanString(record.phone) || "0546605603",
      fulfillmentMethod,
      ...(fulfillmentMethod === "delivery"
        ? {
            deliveryStreet: cleanString(record.deliveryStreet) || "רוטשילד",
            deliveryHouseNumber: cleanString(record.deliveryHouseNumber) || "1",
            apartmentOrNotes: cleanString(record.apartmentOrNotes) || "cardcom-test",
          }
        : {}),
    },
    { cardcomEnvironment: "test" },
  );

  if (!result.ok) {
    console.error("[cardcom-test] create_failed", {
      code: result.code,
      httpStatus: result.httpStatus,
      spotSlug,
    });
    return NextResponse.json(
      { ok: false, error: result.error, code: result.code },
      { status: result.httpStatus },
    );
  }

  console.error("[cardcom-test] create_ok", {
    orderId: result.orderId,
    lowProfileId: result.lowProfileId,
    environment: "test",
    spotSlug,
  });

  return NextResponse.json({
    ok: true,
    environment: "test",
    terminalNumber: 1000,
    orderId: result.orderId,
    lowProfileId: result.lowProfileId,
    paymentUrl: result.paymentUrl,
    amount: offer.consumerPrice,
    plantId: offer.productId,
    posSpotId: posSpot.id,
    spotSlug: posSpot.spotSlug,
    fulfillmentMethod,
    nextSteps: [
      "Open paymentUrl in a browser and complete payment with Cardcom's test card (do not store card details here).",
      "Cardcom will POST JSON to /api/payments/cardcom/webhook.",
      "Watch server logs for [cardcom-webhook] get_lp_result_ok and finalized.",
      "Confirm the order is sold/picked_up and the POS is sold in admin.",
    ],
  });
}
