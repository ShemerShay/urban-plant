/**
 * payment_attempt + owned POS hold + Cardcom LowProfile/Create.
 * Server-only. Does not create an Order, send email, or mark POS sold.
 * Callers may inject createLowProfile for offline tests.
 */

import { randomUUID } from "crypto";

import {
  CardcomError,
  createCardcomLowProfile,
  type CardcomEnvironment,
  type CardcomLowProfileCreateResponse,
  type CreateCardcomLowProfileInput,
} from "@/lib/cardcom";
import { resolveDeliveryAddressFromRequest } from "@/lib/deliveryAddress";
import {
  isValidEmail,
  isValidIsraeliMobilePhone,
} from "@/lib/formValidation";
import { getLocationById } from "@/lib/mockLocations";
import { getOfferById } from "@/lib/offerStorage";
import type { Offer } from "@/lib/offerTypes";
import type { FulfillmentMethod, OrderSnapshot } from "@/lib/orderTypes";
import {
  attachCheckoutSessionIdToAttempt,
  insertPaymentAttempt,
  markPaymentAttemptTerminal,
} from "@/lib/paymentAttemptStorage";
import type { SavedPaymentAttempt } from "@/lib/paymentAttemptTypes";
import { PAYMENT_HOLD_TTL_MS } from "@/lib/paymentHoldExpiry";
import { createPaymentResumeToken } from "@/lib/paymentResume";
import { getPlantById } from "@/lib/plantCatalog";
import { isPosSpotPurchasable } from "@/lib/posSpotHold";
import { expireStalePaymentHold } from "@/lib/paymentHoldExpiry";
import {
  acquirePosSpotHoldForPayment,
  getPosSpotBySpotSlug,
  releasePosSpotHoldForPayment,
} from "@/lib/posSpotStorage";
import type { PosSpot } from "@/lib/posSpotTypes";
import {
  buildCardcomCallbackUrls,
  getPublicAppOrigin,
} from "@/lib/routes";
import type { PlantProduct } from "@/lib/types";

/** Cardcom ProductName max length (mirrored from lib/cardcom.ts). */
const CARDCOM_PRODUCT_NAME_MAX_LENGTH = 50;

export const CANCEL_REASON_POS_UNAVAILABLE_BEFORE_PAYMENT =
  "pos_unavailable_before_payment";
export const CANCEL_REASON_CARDCOM_CREATE_FAILED = "cardcom_create_failed";
export const CANCEL_REASON_CARDCOM_RESPONSE_INVALID = "cardcom_response_invalid";
export const CANCEL_REASON_CARDCOM_SESSION_ATTACH_FAILED =
  "cardcom_session_attach_failed";
export const CANCEL_REASON_PAYMENT_PREP_FAILED = "payment_prep_failed";

export type StartCardcomPaymentPrepInput = {
  plantId: string;
  spotSlug: string;
  fullName: string;
  customerEmail: string;
  phone: string;
  fulfillmentMethod: FulfillmentMethod;
  deliveryStreet?: string;
  deliveryHouseNumber?: string;
  apartmentOrNotes?: string;
};

export type StartCardcomPaymentPrepDeps = {
  createLowProfile?: (
    input: CreateCardcomLowProfileInput,
  ) => Promise<CardcomLowProfileCreateResponse>;
  publicOrigin?: string;
  cardcomEnvironment?: CardcomEnvironment;
};

export type StartCardcomPaymentPrepResult =
  | {
      ok: true;
      /** Correlation id (= payment_attempt.id = Cardcom ReturnValue). */
      orderId: string;
      attemptId: string;
      lowProfileId: string;
      paymentUrl: string;
    }
  | {
      ok: false;
      code:
        | "validation"
        | "not_found"
        | "unavailable"
        | "config"
        | "cardcom_error"
        | "server_error";
      error: string;
      httpStatus: number;
    };

async function buildOrderSnapshot(input: {
  plant: PlantProduct;
  offer: Offer;
  posSpot: PosSpot;
  fulfillmentMethod: FulfillmentMethod;
}): Promise<OrderSnapshot> {
  const { plant, offer, posSpot, fulfillmentMethod } = input;
  const partner = await getLocationById(posSpot.partnerLocationId);
  return {
    productId: plant.id,
    productName: plant.name,
    ...(plant.family ? { productFamily: plant.family } : {}),
    ...(plant.images[0] ? { productImage: plant.images[0] } : {}),
    productDescription: plant.description,
    offerId: offer.id,
    consumerPrice: offer.consumerPrice,
    partnerLocationId: posSpot.partnerLocationId,
    ...(partner ? { partnerLocationName: partner.name } : {}),
    posSpotId: posSpot.id,
    posSpotDescription: posSpot.posName,
    spotSlug: posSpot.spotSlug,
    fulfillmentType: fulfillmentMethod,
  };
}

/**
 * Release owned hold (if requested) and mark attempt terminal.
 */
export async function compensatePaymentPrepFailure(
  attempt: SavedPaymentAttempt,
  posSpotId: string,
  reason: string,
  options?: { releaseHold?: boolean },
): Promise<void> {
  if (options?.releaseHold) {
    try {
      const released = await releasePosSpotHoldForPayment(posSpotId, attempt.id);
      if (!released.ok) {
        console.error(
          "[payment-prep] POS hold release failed after payment prep error",
          {
            attemptId: attempt.id,
            posSpotId,
            outcome: released.outcome,
            reason,
          },
        );
      }
    } catch {
      console.error(
        "[payment-prep] POS hold release threw after payment prep error",
        { attemptId: attempt.id, posSpotId, reason },
      );
    }
  }
  try {
    await markPaymentAttemptTerminal(attempt.id, "cancelled", reason);
  } catch {
    console.error("[payment-prep] attempt cancel failed", {
      attemptId: attempt.id,
      reason,
    });
  }
}

function cardcomProductNameFromAttempt(attempt: SavedPaymentAttempt): string {
  const raw =
    attempt.snapshot?.productName?.trim() ||
    attempt.productName.trim();
  if (!raw) {
    throw new Error("Payment attempt is missing product name for Cardcom Create.");
  }
  return raw.length > CARDCOM_PRODUCT_NAME_MAX_LENGTH
    ? raw.slice(0, CARDCOM_PRODUCT_NAME_MAX_LENGTH)
    : raw;
}

function resolvePublicOrigin(injected?: string): string {
  if (injected?.trim()) {
    const parsed = new URL(injected.trim());
    if (parsed.protocol !== "https:") {
      throw new Error("APP_ORIGIN must use HTTPS.");
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local")
    ) {
      throw new Error("APP_ORIGIN must be a public HTTPS origin (not localhost).");
    }
    return parsed.origin;
  }
  return getPublicAppOrigin();
}

function mapCardcomFailure(error: unknown): {
  reason: string;
  code: "config" | "cardcom_error" | "server_error";
  httpStatus: number;
  error: string;
} {
  if (error instanceof CardcomError) {
    if (error.code === "config") {
      return {
        reason: CANCEL_REASON_CARDCOM_CREATE_FAILED,
        code: "config",
        httpStatus: 500,
        error: "Payment is temporarily unavailable. Try again later.",
      };
    }
    if (error.code === "validation") {
      return {
        reason: CANCEL_REASON_CARDCOM_CREATE_FAILED,
        code: "cardcom_error",
        httpStatus: 502,
        error: "Could not start payment. Try again.",
      };
    }
    if (error.code === "parse" || error.code === "cardcom") {
      return {
        reason: CANCEL_REASON_CARDCOM_RESPONSE_INVALID,
        code: "cardcom_error",
        httpStatus: 502,
        error: "Could not start payment. Try again.",
      };
    }
    return {
      reason: CANCEL_REASON_CARDCOM_CREATE_FAILED,
      code: "cardcom_error",
      httpStatus: 502,
      error: "Could not start payment. Try again.",
    };
  }

  return {
    reason: CANCEL_REASON_PAYMENT_PREP_FAILED,
    code: "server_error",
    httpStatus: 500,
    error: "Could not start payment. Try again.",
  };
}

/**
 * Validate checkout, insert payment_attempt, acquire owned POS hold,
 * call Cardcom LowProfile/Create, attach LowProfileId.
 * Compensates (cancel attempt + release owned hold) on any post-create failure.
 * Does not create an Order.
 */
export async function startCardcomPaymentPrep(
  input: StartCardcomPaymentPrepInput,
  deps: StartCardcomPaymentPrepDeps = {},
): Promise<StartCardcomPaymentPrepResult> {
  const nameStr = input.fullName.trim();
  const emailTrim = input.customerEmail.trim().toLowerCase();
  const phoneStr = input.phone.trim();
  const spotSlug = input.spotSlug.trim();
  const plantId = input.plantId.trim();
  const fulfillmentMethod: FulfillmentMethod =
    input.fulfillmentMethod === "pickup" ? "pickup" : "delivery";

  if (!nameStr) {
    return { ok: false, code: "validation", error: "fullName is required", httpStatus: 400 };
  }
  if (!emailTrim || !isValidEmail(emailTrim)) {
    return {
      ok: false,
      code: "validation",
      error: "customerEmail is required and must be a valid email",
      httpStatus: 400,
    };
  }
  if (!phoneStr || !isValidIsraeliMobilePhone(phoneStr)) {
    return {
      ok: false,
      code: "validation",
      error: "Please enter a valid 10-digit Israeli phone number.",
      httpStatus: 400,
    };
  }
  if (!spotSlug) {
    return { ok: false, code: "validation", error: "spotSlug is required", httpStatus: 400 };
  }
  if (!plantId) {
    return { ok: false, code: "validation", error: "plantId is required", httpStatus: 400 };
  }

  let addressStr = "";
  let notesStr = "";
  if (fulfillmentMethod === "delivery") {
    const resolved = resolveDeliveryAddressFromRequest({
      deliveryStreet: input.deliveryStreet,
      deliveryHouseNumber: input.deliveryHouseNumber,
      apartmentOrNotes: input.apartmentOrNotes,
    });
    if (resolved.error) {
      return { ok: false, code: "validation", error: resolved.error, httpStatus: 400 };
    }
    addressStr = resolved.address;
    notesStr =
      typeof input.apartmentOrNotes === "string" ? input.apartmentOrNotes.trim() : "";
  }

  const catalogPlant = await getPlantById(plantId);
  if (!catalogPlant) {
    return {
      ok: false,
      code: "validation",
      error: "plantId must match a catalog plant",
      httpStatus: 400,
    };
  }

  let posSpot = await getPosSpotBySpotSlug(spotSlug);
  if (!posSpot) {
    return { ok: false, code: "not_found", error: "POS Spot not found", httpStatus: 404 };
  }
  if (posSpot.spotSlug !== spotSlug) {
    return {
      ok: false,
      code: "validation",
      error: "spotSlug does not match POS Spot",
      httpStatus: 400,
    };
  }
  if (posSpot.status === "inactive") {
    return {
      ok: false,
      code: "unavailable",
      error: "This POS Spot is not available for purchase.",
      httpStatus: 409,
    };
  }
  await expireStalePaymentHold(posSpot.id);
  const refreshed = await getPosSpotBySpotSlug(spotSlug);
  if (!refreshed) {
    return { ok: false, code: "not_found", error: "POS Spot not found", httpStatus: 404 };
  }
  posSpot = refreshed;
  if (!isPosSpotPurchasable(posSpot.status)) {
    return {
      ok: false,
      code: "unavailable",
      error: "This POS Spot is no longer available for purchase.",
      httpStatus: 409,
    };
  }

  const offer = await getOfferById(posSpot.currentOfferId);
  if (!offer || offer.status !== "active") {
    return { ok: false, code: "validation", error: "Offer is not available", httpStatus: 400 };
  }
  if (offer.productId !== catalogPlant.id) {
    return {
      ok: false,
      code: "validation",
      error: "Offer does not match selected product",
      httpStatus: 400,
    };
  }
  if (
    typeof offer.consumerPrice !== "number" ||
    !Number.isFinite(offer.consumerPrice) ||
    offer.consumerPrice <= 0
  ) {
    return {
      ok: false,
      code: "validation",
      error: "Offer price is not valid",
      httpStatus: 400,
    };
  }

  const partner = await getLocationById(posSpot.partnerLocationId);
  if (fulfillmentMethod === "pickup" && partner?.pickupDisabled) {
    return {
      ok: false,
      code: "validation",
      error: "Pickup is not available at this location.",
      httpStatus: 400,
    };
  }

  const attemptId = randomUUID();
  const paymentResumeToken = createPaymentResumeToken();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + PAYMENT_HOLD_TTL_MS).toISOString();
  const snapshot = await buildOrderSnapshot({
    plant: catalogPlant,
    offer,
    posSpot,
    fulfillmentMethod,
  });

  const attempt: SavedPaymentAttempt = {
    id: attemptId,
    status: "created",
    posSpotId: posSpot.id,
    offerId: offer.id,
    productId: catalogPlant.id,
    productName: catalogPlant.name,
    fullName: nameStr,
    customerEmail: emailTrim,
    phone: phoneStr,
    address: fulfillmentMethod === "delivery" ? addressStr : "",
    apartmentOrNotes: fulfillmentMethod === "delivery" ? notesStr : "",
    fulfillmentMethod,
    amount: offer.consumerPrice,
    snapshot,
    paymentResumeToken,
    expiresAt,
    createdAt,
    updatedAt: createdAt,
  };

  try {
    await insertPaymentAttempt(attempt);
  } catch {
    return {
      ok: false,
      code: "server_error",
      error: "Could not start payment. Try again.",
      httpStatus: 500,
    };
  }

  const hold = await acquirePosSpotHoldForPayment(posSpot.id, attemptId);
  if (!hold.ok) {
    await compensatePaymentPrepFailure(
      attempt,
      posSpot.id,
      CANCEL_REASON_POS_UNAVAILABLE_BEFORE_PAYMENT,
      { releaseHold: false },
    );
    return {
      ok: false,
      code: hold.outcome === "not_found" ? "not_found" : "unavailable",
      error:
        hold.outcome === "not_found"
          ? "POS Spot not found"
          : "This POS Spot is no longer available for purchase.",
      httpStatus: hold.outcome === "not_found" ? 404 : 409,
    };
  }

  let publicOrigin: string;
  try {
    publicOrigin = resolvePublicOrigin(deps.publicOrigin);
  } catch {
    await compensatePaymentPrepFailure(
      attempt,
      posSpot.id,
      CANCEL_REASON_CARDCOM_CREATE_FAILED,
      { releaseHold: true },
    );
    return {
      ok: false,
      code: "config",
      error: "Payment is temporarily unavailable. Try again later.",
      httpStatus: 500,
    };
  }

  let productName: string;
  try {
    productName = cardcomProductNameFromAttempt(attempt);
  } catch {
    await compensatePaymentPrepFailure(
      attempt,
      posSpot.id,
      CANCEL_REASON_PAYMENT_PREP_FAILED,
      { releaseHold: true },
    );
    return {
      ok: false,
      code: "server_error",
      error: "Could not start payment. Try again.",
      httpStatus: 500,
    };
  }

  if (
    typeof attempt.amount !== "number" ||
    !Number.isFinite(attempt.amount) ||
    attempt.amount <= 0
  ) {
    await compensatePaymentPrepFailure(
      attempt,
      posSpot.id,
      CANCEL_REASON_PAYMENT_PREP_FAILED,
      { releaseHold: true },
    );
    return {
      ok: false,
      code: "server_error",
      error: "Could not start payment. Try again.",
      httpStatus: 500,
    };
  }

  const callbacks = buildCardcomCallbackUrls(publicOrigin, {
    orderId: attempt.id,
    spotSlug: posSpot.spotSlug,
    resumeToken: paymentResumeToken,
  });
  const cardcomEnvironment: CardcomEnvironment =
    deps.cardcomEnvironment === "test" ? "test" : "production";
  const createInput: CreateCardcomLowProfileInput = {
    amount: attempt.amount,
    returnValue: attempt.id,
    productName,
    successRedirectUrl: callbacks.successRedirectUrl,
    failedRedirectUrl: callbacks.failedRedirectUrl,
    webHookUrl: callbacks.webHookUrl,
    cardOwnerName: attempt.fullName,
    cardOwnerPhone: attempt.phone,
    cardOwnerEmail: attempt.customerEmail,
  };

  const createFn =
    deps.createLowProfile ??
    ((createPayload: CreateCardcomLowProfileInput) =>
      createCardcomLowProfile(createPayload, { environment: cardcomEnvironment }));

  let cardcomResult: CardcomLowProfileCreateResponse;
  try {
    cardcomResult = await createFn(createInput);
  } catch (error) {
    const mapped = mapCardcomFailure(error);
    await compensatePaymentPrepFailure(attempt, posSpot.id, mapped.reason, {
      releaseHold: true,
    });
    return {
      ok: false,
      code: mapped.code,
      error: mapped.error,
      httpStatus: mapped.httpStatus,
    };
  }

  const lowProfileId = cardcomResult.LowProfileId?.trim() ?? "";
  const paymentUrl = cardcomResult.Url?.trim() ?? "";
  if (!lowProfileId || !paymentUrl) {
    await compensatePaymentPrepFailure(
      attempt,
      posSpot.id,
      CANCEL_REASON_CARDCOM_RESPONSE_INVALID,
      { releaseHold: true },
    );
    return {
      ok: false,
      code: "cardcom_error",
      error: "Could not start payment. Try again.",
      httpStatus: 502,
    };
  }

  let attach;
  try {
    attach = await attachCheckoutSessionIdToAttempt(attempt.id, lowProfileId, {
      cardcomEnv: cardcomEnvironment,
    });
  } catch {
    await compensatePaymentPrepFailure(
      attempt,
      posSpot.id,
      CANCEL_REASON_CARDCOM_SESSION_ATTACH_FAILED,
      { releaseHold: true },
    );
    return {
      ok: false,
      code: "server_error",
      error: "Could not start payment. Try again.",
      httpStatus: 500,
    };
  }

  if (!attach.ok) {
    await compensatePaymentPrepFailure(
      attempt,
      posSpot.id,
      CANCEL_REASON_CARDCOM_SESSION_ATTACH_FAILED,
      { releaseHold: true },
    );
    return {
      ok: false,
      code: "server_error",
      error: "Could not start payment. Try again.",
      httpStatus: 500,
    };
  }

  if (cardcomEnvironment === "test") {
    console.error("[cardcom-test] lowprofile_created", {
      attemptId: attempt.id,
      lowProfileId,
      attemptStatus: "awaiting_payment",
      posSpotId: posSpot.id,
      posStatus: "held_for_payment",
      environment: "test",
    });
  }

  return {
    ok: true,
    orderId: attempt.id,
    attemptId: attempt.id,
    lowProfileId,
    paymentUrl,
  };
}
