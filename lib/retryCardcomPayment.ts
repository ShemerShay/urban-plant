/**
 * Retry Cardcom LowProfile/Create for an awaiting payment_attempt (or legacy pending Order).
 * Requires payment_resume_token. Same correlation row; new LowProfileId.
 * Never creates an Order. Never releases POS without webhook/expiry.
 */

import {
  CardcomError,
  createCardcomLowProfile,
  type CardcomEnvironment,
  type CreateCardcomLowProfileInput,
} from "@/lib/cardcom";
import {
  claimPaymentAttemptRetryLock,
  getAwaitingPaymentAttemptForResume,
  releasePaymentAttemptRetryLock,
  rotateCheckoutSessionIdForAttemptResume,
} from "@/lib/paymentAttemptStorage";
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

function productNameFromSource(source: {
  snapshot?: { productName?: string };
  productName?: string;
  plantName?: string;
}): string {
  const raw =
    source.snapshot?.productName?.trim() ||
    source.productName?.trim() ||
    source.plantName?.trim() ||
    "";
  if (!raw) throw new Error("missing product name");
  return raw.length > CARDCOM_PRODUCT_NAME_MAX_LENGTH
    ? raw.slice(0, CARDCOM_PRODUCT_NAME_MAX_LENGTH)
    : raw;
}

async function retryAttemptPayment(
  attemptId: string,
  resumeToken: string,
  deps: {
    publicOrigin?: string;
    createLowProfile?: (
      createInput: CreateCardcomLowProfileInput,
    ) => Promise<{ LowProfileId?: string; Url?: string; ResponseCode?: number }>;
    cardcomEnvironment?: CardcomEnvironment;
  },
): Promise<RetryCardcomPaymentResult> {
  const attemptBefore = await getAwaitingPaymentAttemptForResume(attemptId, resumeToken);
  if (!attemptBefore) {
    return {
      ok: false,
      code: "unauthorized",
      error: "Payment session is not available to retry.",
      httpStatus: 403,
    };
  }

  await expireStalePaymentHold(attemptBefore.posSpotId);

  const attempt = await getAwaitingPaymentAttemptForResume(attemptId, resumeToken);
  if (!attempt) {
    return {
      ok: false,
      code: "unauthorized",
      error: "Payment session is not available to retry.",
      httpStatus: 403,
    };
  }

  const posSpot = await getPosSpotById(attempt.posSpotId);
  if (
    !posSpot ||
    posSpot.status !== "held_for_payment" ||
    posSpot.paymentHoldAttemptId !== attempt.id
  ) {
    return {
      ok: false,
      code: "conflict",
      error: "This plant is no longer held for your payment.",
      httpStatus: 409,
    };
  }

  const spotSlug = attempt.snapshot?.spotSlug?.trim() || posSpot.spotSlug;
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
    productName = productNameFromSource(attempt);
  } catch {
    return {
      ok: false,
      code: "server_error",
      error: "Could not retry payment. Try again.",
      httpStatus: 500,
    };
  }

  const claimed = await claimPaymentAttemptRetryLock({
    attemptId: attempt.id,
    resumeToken: attempt.paymentResumeToken,
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
    if (claimed.reason === "not_awaiting" || claimed.reason === "token_mismatch") {
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
    orderId: attempt.id,
    spotSlug,
    resumeToken: attempt.paymentResumeToken,
  });

  const cardcomEnvironment: CardcomEnvironment =
    deps.cardcomEnvironment === "test"
      ? "test"
      : attempt.cardcomEnv === "test"
        ? "test"
        : "production";

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
    ((payload: CreateCardcomLowProfileInput) =>
      createCardcomLowProfile(payload, { environment: cardcomEnvironment }));

  let cardcomResult: { LowProfileId?: string; Url?: string };
  try {
    cardcomResult = await createFn(createInput);
  } catch (error) {
    await releasePaymentAttemptRetryLock(attempt.id);
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
    await releasePaymentAttemptRetryLock(attempt.id);
    return {
      ok: false,
      code: "cardcom_error",
      error: "Could not start payment. Try again.",
      httpStatus: 502,
    };
  }

  const rotated = await rotateCheckoutSessionIdForAttemptResume({
    attemptId: attempt.id,
    resumeToken: attempt.paymentResumeToken,
    newCheckoutSessionId: lowProfileId,
    cardcomEnv: cardcomEnvironment,
  });

  if (!rotated.ok) {
    await releasePaymentAttemptRetryLock(attempt.id);
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

  await releasePaymentAttemptRetryLock(attempt.id);

  return {
    ok: true,
    orderId: attempt.id,
    lowProfileId,
    paymentUrl,
  };
}

async function retryLegacyOrderPayment(
  orderId: string,
  resumeToken: string,
  deps: {
    publicOrigin?: string;
    createLowProfile?: (
      createInput: CreateCardcomLowProfileInput,
    ) => Promise<{ LowProfileId?: string; Url?: string; ResponseCode?: number }>;
    cardcomEnvironment?: CardcomEnvironment;
  },
): Promise<RetryCardcomPaymentResult> {
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
    productName = productNameFromSource(order);
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
    ((payload: CreateCardomLowProfileInput) =>
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
  const correlationId = input.orderId.trim();
  const resumeToken = input.resumeToken.trim();
  if (!correlationId || !resumeToken) {
    return {
      ok: false,
      code: "validation",
      error: "orderId and resume token are required",
      httpStatus: 400,
    };
  }

  const attempt = await getAwaitingPaymentAttemptForResume(correlationId, resumeToken);
  if (attempt) {
    return retryAttemptPayment(correlationId, resumeToken, deps);
  }

  return retryLegacyOrderPayment(correlationId, resumeToken, deps);
}
