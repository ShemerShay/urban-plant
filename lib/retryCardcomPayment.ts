/**
 * Retry Cardcom LowProfile/Create for an existing pending_payment order.
 * Requires payment_resume_token (holder proof). Same order row; new LowProfileId.
 * Does not create a second completed sale; does not release POS hold.
 *
 * Concurrency: claimPaymentRetryLock before Cardcom Create so only one Create runs.
 */

import {
  CardcomError,
  createCardcomLowProfile,
  type CardcomEnvironment,
  type CreateCardcomLowProfileInput,
} from "@/lib/cardcom";
import { expireStalePaymentHold } from "@/lib/paymentHoldExpiry";
import {
  claimPaymentRetryLock,
  getPendingOrderForPaymentResume,
  releasePaymentRetryLock,
  rotateCheckoutSessionIdForResume,
} from "@/lib/ordersStorage";
import { getPosSpotById } from "@/lib/posSpotStorage";
import { buildCardcomCallbackUrls, getPublicAppOrigin } from "@/lib/routes";

const CARDCOM_PRODUCT_NAME_MAX_LENGTH = 50;

export type RetryCardcomPaymentResult =
  | {
      ok: true;
      orderId: string;
      lowProfileId: string;
      paymentUrl: string;
    }
  | {
      ok: false;
      code:
        | "validation"
        | "unauthorized"
        | "not_found"
        | "conflict"
        | "busy"
        | "config"
        | "cardcom_error"
        | "server_error";
      error: string;
      httpStatus: number;
    };

function productNameFromOrder(order: {
  snapshot?: { productName?: string };
  plantName: string;
}): string {
  const raw = order.snapshot?.productName?.trim() || order.plantName.trim();
  if (!raw) throw new Error("missing product name");
  return raw.length > CARDCOM_PRODUCT_NAME_MAX_LENGTH
    ? raw.slice(0, CARDCOM_PRODUCT_NAME_MAX_LENGTH)
    : raw;
}

export async function retryCardcomPayment(
  input: {
    orderId: string;
    resumeToken: string;
  },
  deps: {
    publicOrigin?: string;
    createLowProfile?: (
      createInput: CreateCardcomLowProfileInput,
    ) => Promise<{ LowProfileId?: string; Url?: string; ResponseCode?: number }>;
    cardcomEnvironment?: CardcomEnvironment;
  } = {},
): Promise<RetryCardcomPaymentResult> {
  const orderId = input.orderId.trim();
  const resumeToken = input.resumeToken.trim();
  if (!orderId || !resumeToken) {
    return {
      ok: false,
      code: "validation",
      error: "orderId and resume token are required",
      httpStatus: 400,
    };
  }

  const orderBefore = await getPendingOrderForPaymentResume(orderId, resumeToken);
  if (!orderBefore) {
    return {
      ok: false,
      code: "unauthorized",
      error: "Payment session is not available to retry.",
      httpStatus: 403,
    };
  }

  if (!orderBefore.posSpotId) {
    return {
      ok: false,
      code: "conflict",
      error: "Could not retry payment. Try again.",
      httpStatus: 409,
    };
  }

  await expireStalePaymentHold(orderBefore.posSpotId);

  const order = await getPendingOrderForPaymentResume(orderId, resumeToken);
  if (!order || !order.posSpotId) {
    return {
      ok: false,
      code: "unauthorized",
      error: "Payment session is not available to retry.",
      httpStatus: 403,
    };
  }

  const posSpot = await getPosSpotById(order.posSpotId);
  if (!posSpot || posSpot.status !== "held_for_payment") {
    return {
      ok: false,
      code: "conflict",
      error: "This plant is no longer held for your payment.",
      httpStatus: 409,
    };
  }

  const spotSlug = order.snapshot?.spotSlug?.trim() || posSpot.spotSlug;
  if (!spotSlug) {
    return {
      ok: false,
      code: "server_error",
      error: "Could not retry payment. Try again.",
      httpStatus: 500,
    };
  }

  let publicOrigin: string;
  try {
    if (deps.publicOrigin?.trim()) {
      publicOrigin = new URL(deps.publicOrigin.trim()).origin;
    } else {
      publicOrigin = getPublicAppOrigin();
    }
  } catch {
    return {
      ok: false,
      code: "config",
      error: "Payment is temporarily unavailable. Try again later.",
      httpStatus: 500,
    };
  }

  let productName: string;
  try {
    productName = productNameFromOrder(order);
  } catch {
    return {
      ok: false,
      code: "server_error",
      error: "Could not retry payment. Try again.",
      httpStatus: 500,
    };
  }

  const resume = order.paymentResumeToken;
  if (!resume) {
    return {
      ok: false,
      code: "unauthorized",
      error: "Payment session is not available to retry.",
      httpStatus: 403,
    };
  }

  const claimed = await claimPaymentRetryLock({
    orderId: order.orderId,
    resumeToken: resume,
  });
  if (!claimed.ok) {
    if (claimed.reason === "busy") {
      return {
        ok: false,
        code: "busy",
        error: "Payment is already being prepared. Please wait.",
        httpStatus: 409,
      };
    }
    if (claimed.reason === "not_pending" || claimed.reason === "token_mismatch") {
      return {
        ok: false,
        code: "unauthorized",
        error: "Payment session is not available to retry.",
        httpStatus: 403,
      };
    }
    return {
      ok: false,
      code: "conflict",
      error: "Could not retry payment. Try again.",
      httpStatus: 409,
    };
  }

  const callbacks = buildCardcomCallbackUrls(publicOrigin, {
    orderId: order.orderId,
    spotSlug,
    resumeToken: resume,
  });

  const cardcomEnvironment: CardcomEnvironment =
    deps.cardcomEnvironment === "test"
      ? "test"
      : order.cardcomEnv === "test"
        ? "test"
        : "production";

  const createInput: CreateCardcomLowProfileInput = {
    amount: order.price,
    returnValue: order.orderId,
    productName,
    successRedirectUrl: callbacks.successRedirectUrl,
    failedRedirectUrl: callbacks.failedRedirectUrl,
    webHookUrl: callbacks.webHookUrl,
    cardOwnerName: order.fullName,
    cardOwnerPhone: order.phone,
    cardOwnerEmail: order.customerEmail ?? "",
  };

  const createFn =
    deps.createLowProfile ??
    ((payload: CreateCardcomLowProfileInput) =>
      createCardcomLowProfile(payload, { environment: cardcomEnvironment }));

  let cardcomResult: { LowProfileId?: string; Url?: string };
  try {
    cardcomResult = await createFn(createInput);
  } catch (error) {
    await releasePaymentRetryLock(order.orderId);
    if (error instanceof CardcomError && error.code === "config") {
      return {
        ok: false,
        code: "config",
        error: "Payment is temporarily unavailable. Try again later.",
        httpStatus: 500,
      };
    }
    return {
      ok: false,
      code: "cardcom_error",
      error: "Could not start payment. Try again.",
      httpStatus: 502,
    };
  }

  const lowProfileId = cardcomResult.LowProfileId?.trim() ?? "";
  const paymentUrl = cardcomResult.Url?.trim() ?? "";
  if (!lowProfileId || !paymentUrl) {
    await releasePaymentRetryLock(order.orderId);
    return {
      ok: false,
      code: "cardcom_error",
      error: "Could not start payment. Try again.",
      httpStatus: 502,
    };
  }

  const rotated = await rotateCheckoutSessionIdForResume({
    orderId: order.orderId,
    resumeToken: resume,
    newCheckoutSessionId: lowProfileId,
    cardcomEnv: cardcomEnvironment,
  });

  if (!rotated.ok) {
    await releasePaymentRetryLock(order.orderId);
    return {
      ok: false,
      code:
        rotated.reason === "token_mismatch"
          ? "unauthorized"
          : rotated.reason === "not_found"
            ? "not_found"
            : "conflict",
      error: "Could not retry payment. Try again.",
      httpStatus: rotated.reason === "token_mismatch" ? 403 : 409,
    };
  }

  await releasePaymentRetryLock(order.orderId);

  return {
    ok: true,
    orderId: order.orderId,
    lowProfileId,
    paymentUrl,
  };
}
