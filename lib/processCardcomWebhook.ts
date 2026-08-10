/**
 * Cardcom webhook → GetLpResult verification → attempt finalize (Order on success)
 * or legacy pending Order finalize. Document/email run after Order commit only.
 */

import {
  CardcomError,
  CARDCOM_ISO_COIN_ID_ILS,
  cardcomAmountsEqual,
  getCardcomLowProfileResult,
  isCardcomEnvironment,
  type CardcomEnvironment,
  type CardcomLowProfileResult,
} from "@/lib/cardcom";
import { parseCardcomWebhookLowProfileResult } from "@/lib/cardcomWebhookParse";
import { getLocationById } from "@/lib/mockLocations";
import {
  finalizeVerifiedPaymentAttemptAtomic,
  getPaymentAttemptByCheckoutSessionId,
  markPaymentAttemptNeedsReconciliation,
} from "@/lib/paymentAttemptStorage";
import type { SavedPaymentAttempt } from "@/lib/paymentAttemptTypes";
import { expireStalePaymentHold } from "@/lib/paymentHoldExpiry";
import {
  finalizeVerifiedPendingPaymentAtomic,
  getOrderByCheckoutSessionId,
} from "@/lib/ordersStorage";
import type { SavedOrder } from "@/lib/orderTypes";
import {
  processOrderDocumentAndEmail,
  type ProcessOrderDocumentAndEmailDeps,
} from "@/lib/processOrderDocumentAndEmail";
import { isVerifiedPaidOrderStatus } from "@/lib/status";
import { getPosSpotById } from "@/lib/posSpotStorage";

export type ProcessCardcomWebhookDeps = {
  getLpResult?: (
    lowProfileId: string,
    environment: CardcomEnvironment,
  ) => Promise<CardcomLowProfileResult>;
  processDocumentAndEmail?: (orderId: string) => Promise<unknown>;
  documentEmailDeps?: ProcessOrderDocumentAndEmailDeps;
};

export type ProcessCardcomWebhookResult = {
  httpStatus: number;
  body: { ok: true } | { ok: false; error: string };
  outcome:
    | "finalized"
    | "already_finalized"
    | "needs_reconciliation"
    | "ignored_unknown"
    | "ignored_cancelled"
    | "ignored_verification"
    | "ignored_ineligible"
    | "bad_request"
    | "upstream_error"
    | "server_error";
};

function logWebhookOp(
  message: string,
  context: Record<string, string | number | boolean | null | undefined>,
): void {
  console.error(`[cardcom-webhook] ${message}`, context);
}

function resolveAttemptCardcomEnv(attempt: SavedPaymentAttempt): CardcomEnvironment {
  return isCardcomEnvironment(attempt.cardcomEnv) ? attempt.cardcomEnv : "production";
}

function resolveOrderCardcomEnv(order: SavedOrder): CardcomEnvironment {
  return isCardcomEnvironment(order.cardcomEnv) ? order.cardcomEnv : "production";
}

function verifyGetLpResultAgainstAttempt(
  result: CardcomLowProfileResult,
  attempt: SavedPaymentAttempt,
): { ok: true } | { ok: false; reason: string } {
  if (result.lowProfileId !== (attempt.checkoutSessionId ?? "")) {
    return { ok: false, reason: "low_profile_mismatch" };
  }
  if (result.returnValue !== attempt.id) {
    return { ok: false, reason: "return_value_mismatch" };
  }
  if (!cardcomAmountsEqual(result.transaction.amount, attempt.amount)) {
    return { ok: false, reason: "amount_mismatch" };
  }
  if (result.transaction.coinId !== CARDCOM_ISO_COIN_ID_ILS) {
    return { ok: false, reason: "coin_mismatch" };
  }
  return { ok: true };
}

function verifyGetLpResultAgainstOrder(
  result: CardcomLowProfileResult,
  order: SavedOrder,
): { ok: true } | { ok: false; reason: string } {
  if (result.lowProfileId !== (order.checkoutSessionId ?? "")) {
    return { ok: false, reason: "low_profile_mismatch" };
  }
  if (result.returnValue !== order.orderId) {
    return { ok: false, reason: "return_value_mismatch" };
  }
  if (!cardcomAmountsEqual(result.transaction.amount, order.price)) {
    return { ok: false, reason: "amount_mismatch" };
  }
  if (result.transaction.coinId !== CARDCOM_ISO_COIN_ID_ILS) {
    return { ok: false, reason: "coin_mismatch" };
  }
  return { ok: true };
}

function resolveVerifiedTransactionId(
  result: CardcomLowProfileResult,
): number | undefined {
  const nested = result.transaction.transactionId;
  if (typeof nested === "number" && Number.isFinite(nested)) {
    return Math.trunc(nested);
  }
  if (typeof result.transactionId === "number" && Number.isFinite(result.transactionId)) {
    return Math.trunc(result.transactionId);
  }
  return undefined;
}

async function runPostPaymentDocumentEmail(
  orderId: string,
  deps: ProcessCardcomWebhookDeps,
): Promise<void> {
  try {
    if (deps.processDocumentAndEmail) {
      await deps.processDocumentAndEmail(orderId);
      return;
    }
    await processOrderDocumentAndEmail(orderId, deps.documentEmailDeps);
  } catch (error) {
    logWebhookOp("document_email_threw", {
      orderId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

async function fetchLpResult(
  lowProfileId: string,
  environment: CardcomEnvironment,
  deps: ProcessCardcomWebhookDeps,
  contextId: string,
): Promise<
  | { ok: true; verified: CardcomLowProfileResult }
  | { ok: false; result: ProcessCardcomWebhookResult }
> {
  const getLpResult =
    deps.getLpResult ??
    ((id: string, env: CardcomEnvironment) =>
      getCardcomLowProfileResult({ lowProfileId: id }, { environment: env }));

  try {
    const verified = await getLpResult(lowProfileId, environment);
    return { ok: true, verified };
  } catch (error) {
    if (error instanceof CardcomError) {
      if (
        error.code === "network" ||
        error.code === "http" ||
        error.code === "config"
      ) {
        logWebhookOp("get_lp_result_upstream_failure", {
          lowProfileId,
          contextId,
          code: error.code,
          cardcomEnvironment: environment,
        });
        return {
          ok: false,
          result: {
            httpStatus: 502,
            body: { ok: false, error: "Payment verification temporarily unavailable" },
            outcome: "upstream_error",
          },
        };
      }
      logWebhookOp("get_lp_result_not_successful", {
        lowProfileId,
        contextId,
        code: error.code,
        responseCode: error.responseCode ?? null,
        cardcomEnvironment: environment,
      });
      return {
        ok: false,
        result: {
          httpStatus: 200,
          body: { ok: true },
          outcome: "ignored_verification",
        },
      };
    }
    logWebhookOp("get_lp_result_unexpected_error", {
      lowProfileId,
      contextId,
    });
    return {
      ok: false,
      result: {
        httpStatus: 500,
        body: { ok: false, error: "Internal error" },
        outcome: "server_error",
      },
    };
  }
}

async function processAttemptWebhook(
  lowProfileId: string,
  attemptBeforeVerify: SavedPaymentAttempt,
  deps: ProcessCardcomWebhookDeps,
): Promise<ProcessCardcomWebhookResult> {
  if (attemptBeforeVerify.status === "finalized") {
    if (
      attemptBeforeVerify.checkoutSessionId === lowProfileId &&
      attemptBeforeVerify.finalizedOrderId
    ) {
      logWebhookOp("webhook_received_already_finalized", {
        attemptId: attemptBeforeVerify.id,
        orderId: attemptBeforeVerify.finalizedOrderId,
        lowProfileId,
        attemptStatus: attemptBeforeVerify.status,
      });
      await runPostPaymentDocumentEmail(attemptBeforeVerify.finalizedOrderId, deps);
      return {
        httpStatus: 200,
        body: { ok: true },
        outcome: "already_finalized",
      };
    }
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_ineligible",
    };
  }

  if (attemptBeforeVerify.status === "needs_reconciliation") {
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "needs_reconciliation",
    };
  }

  const cardcomEnvironment = resolveAttemptCardcomEnv(attemptBeforeVerify);
  logWebhookOp("webhook_received", {
    attemptId: attemptBeforeVerify.id,
    lowProfileId,
    attemptStatus: attemptBeforeVerify.status,
    cardcomEnvironment,
  });

  const lp = await fetchLpResult(
    lowProfileId,
    cardcomEnvironment,
    deps,
    attemptBeforeVerify.id,
  );
  if (!lp.ok) return lp.result;

  const verified = lp.verified;
  logWebhookOp("get_lp_result_ok", {
    attemptId: attemptBeforeVerify.id,
    lowProfileId: verified.lowProfileId,
    cardcomEnvironment,
  });

  if (verified.lowProfileId !== lowProfileId) {
    logWebhookOp("verified_low_profile_differs_from_request", {
      requested: lowProfileId,
      verified: verified.lowProfileId,
      attemptId: attemptBeforeVerify.id,
    });
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_verification",
    };
  }

  const attempt = await getPaymentAttemptByCheckoutSessionId(verified.lowProfileId);
  if (!attempt) {
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_unknown",
    };
  }

  if (attempt.status === "finalized" && attempt.finalizedOrderId) {
    await runPostPaymentDocumentEmail(attempt.finalizedOrderId, deps);
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "already_finalized",
    };
  }

  if (
    attempt.status === "expired" ||
    attempt.status === "cancelled" ||
    attempt.status === "failed" ||
    attempt.status === "needs_reconciliation"
  ) {
    const checksLate = verifyGetLpResultAgainstAttempt(verified, attempt);
    if (!checksLate.ok) {
      return {
        httpStatus: 200,
        body: { ok: true },
        outcome: "ignored_verification",
      };
    }
    const cardcomTransactionId = resolveVerifiedTransactionId(verified);
    const marked = await markPaymentAttemptNeedsReconciliation({
      attemptId: attempt.id,
      checkoutSessionId: verified.lowProfileId,
      cardcomTransactionId,
      reason: `late_cardcom_success_after_${attempt.status}`,
    });
    logWebhookOp("needs_reconciliation", {
      attemptId: attempt.id,
      lowProfileId: verified.lowProfileId,
      priorStatus: attempt.status,
      marked: Boolean(marked),
    });
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "needs_reconciliation",
    };
  }

  if (attempt.status !== "awaiting_payment") {
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_ineligible",
    };
  }

  const checks = verifyGetLpResultAgainstAttempt(verified, attempt);
  if (!checks.ok) {
    logWebhookOp("verification_failed", {
      attemptId: attempt.id,
      lowProfileId: verified.lowProfileId,
      reason: checks.reason,
    });
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_verification",
    };
  }

  await expireStalePaymentHold(attempt.posSpotId);
  const attemptAfterExpiry = await getPaymentAttemptByCheckoutSessionId(
    verified.lowProfileId,
  );
  if (!attemptAfterExpiry) {
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_unknown",
    };
  }

  if (
    attemptAfterExpiry.status === "expired" ||
    attemptAfterExpiry.status === "cancelled" ||
    attemptAfterExpiry.status === "failed" ||
    attemptAfterExpiry.status === "needs_reconciliation"
  ) {
    const cardcomTransactionId = resolveVerifiedTransactionId(verified);
    await markPaymentAttemptNeedsReconciliation({
      attemptId: attemptAfterExpiry.id,
      checkoutSessionId: verified.lowProfileId,
      cardcomTransactionId,
      reason: `late_cardcom_success_after_${attemptAfterExpiry.status}`,
    });
    logWebhookOp("needs_reconciliation_after_hold_expiry", {
      attemptId: attemptAfterExpiry.id,
      lowProfileId: verified.lowProfileId,
    });
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "needs_reconciliation",
    };
  }

  if (attemptAfterExpiry.status === "finalized" && attemptAfterExpiry.finalizedOrderId) {
    await runPostPaymentDocumentEmail(attemptAfterExpiry.finalizedOrderId, deps);
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "already_finalized",
    };
  }

  if (attemptAfterExpiry.status !== "awaiting_payment") {
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_ineligible",
    };
  }

  const posSpot = await getPosSpotById(attemptAfterExpiry.posSpotId);
  if (
    !posSpot ||
    posSpot.status !== "held_for_payment" ||
    posSpot.paymentHoldAttemptId !== attemptAfterExpiry.id
  ) {
    logWebhookOp("pos_not_held_by_attempt", {
      attemptId: attemptAfterExpiry.id,
      posSpotId: attemptAfterExpiry.posSpotId,
      posStatus: posSpot?.status ?? null,
      owner: posSpot?.paymentHoldAttemptId ?? null,
    });
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_ineligible",
    };
  }

  const cardcomTransactionId = resolveVerifiedTransactionId(verified);
  const partnerId = attemptAfterExpiry.snapshot?.partnerLocationId;
  const partner = partnerId ? await getLocationById(partnerId) : undefined;

  try {
    const finalized = await finalizeVerifiedPaymentAttemptAtomic({
      attemptId: attemptAfterExpiry.id,
      checkoutSessionId: verified.lowProfileId,
      posSpotId: attemptAfterExpiry.posSpotId,
      fulfillmentMethod: attemptAfterExpiry.fulfillmentMethod,
      cardcomTransactionId,
      partnerLocationAddress: partner?.address ?? null,
    });

    if (!finalized.ok) {
      const again = await getPaymentAttemptByCheckoutSessionId(verified.lowProfileId);
      if (again?.status === "finalized" && again.finalizedOrderId) {
        await runPostPaymentDocumentEmail(again.finalizedOrderId, deps);
        return {
          httpStatus: 200,
          body: { ok: true },
          outcome: "already_finalized",
        };
      }
      logWebhookOp("finalize_conflict", {
        attemptId: attemptAfterExpiry.id,
        lowProfileId: verified.lowProfileId,
      });
      return {
        httpStatus: 200,
        body: { ok: true },
        outcome: "ignored_ineligible",
      };
    }

    logWebhookOp("finalized", {
      attemptId: attemptAfterExpiry.id,
      orderId: finalized.order.orderId,
      lowProfileId: verified.lowProfileId,
      orderStatus: finalized.order.orderStatus,
      posSpotId: attemptAfterExpiry.posSpotId,
      posStatus: "sold",
      cardcomEnvironment,
      cardcomTransactionId: cardcomTransactionId ?? null,
    });

    await runPostPaymentDocumentEmail(finalized.order.orderId, deps);

    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "finalized",
    };
  } catch {
    logWebhookOp("finalize_threw", {
      attemptId: attemptAfterExpiry.id,
      lowProfileId: verified.lowProfileId,
    });
    return {
      httpStatus: 500,
      body: { ok: false, error: "Internal error" },
      outcome: "server_error",
    };
  }
}

/** Legacy pending_payment Order path (pre-cutover sessions). */
async function processLegacyOrderWebhook(
  lowProfileId: string,
  orderBeforeVerify: SavedOrder,
  deps: ProcessCardcomWebhookDeps,
): Promise<ProcessCardcomWebhookResult> {
  if (orderBeforeVerify.orderStatus === "cancelled") {
    logWebhookOp("order_cancelled_skip_finalize", {
      orderId: orderBeforeVerify.orderId,
      lowProfileId,
    });
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_cancelled",
    };
  }

  if (isVerifiedPaidOrderStatus(orderBeforeVerify.orderStatus)) {
    if (orderBeforeVerify.checkoutSessionId === lowProfileId) {
      logWebhookOp("webhook_received_already_finalized", {
        orderId: orderBeforeVerify.orderId,
        lowProfileId,
        orderStatus: orderBeforeVerify.orderStatus,
      });
      await runPostPaymentDocumentEmail(orderBeforeVerify.orderId, deps);
      return {
        httpStatus: 200,
        body: { ok: true },
        outcome: "already_finalized",
      };
    }
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_ineligible",
    };
  }

  if (orderBeforeVerify.orderStatus !== "pending_payment") {
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_ineligible",
    };
  }

  const cardcomEnvironment = resolveOrderCardcomEnv(orderBeforeVerify);
  logWebhookOp("webhook_received", {
    orderId: orderBeforeVerify.orderId,
    lowProfileId,
    orderStatus: orderBeforeVerify.orderStatus,
    cardcomEnvironment,
  });

  const lp = await fetchLpResult(
    lowProfileId,
    cardcomEnvironment,
    deps,
    orderBeforeVerify.orderId,
  );
  if (!lp.ok) return lp.result;

  const verified = lp.verified;
  logWebhookOp("get_lp_result_ok", {
    orderId: orderBeforeVerify.orderId,
    lowProfileId: verified.lowProfileId,
    cardcomEnvironment,
  });

  if (verified.lowProfileId !== lowProfileId) {
    logWebhookOp("verified_low_profile_differs_from_request", {
      requested: lowProfileId,
      verified: verified.lowProfileId,
      orderId: orderBeforeVerify.orderId,
    });
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_verification",
    };
  }

  const order = await getOrderByCheckoutSessionId(verified.lowProfileId);
  if (!order) {
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_unknown",
    };
  }

  if (order.orderStatus === "cancelled") {
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_cancelled",
    };
  }

  if (isVerifiedPaidOrderStatus(order.orderStatus)) {
    if (order.checkoutSessionId === verified.lowProfileId) {
      await runPostPaymentDocumentEmail(order.orderId, deps);
      return {
        httpStatus: 200,
        body: { ok: true },
        outcome: "already_finalized",
      };
    }
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_ineligible",
    };
  }

  if (order.orderStatus !== "pending_payment") {
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_ineligible",
    };
  }

  const checks = verifyGetLpResultAgainstOrder(verified, order);
  if (!checks.ok) {
    logWebhookOp("verification_failed", {
      orderId: order.orderId,
      lowProfileId: verified.lowProfileId,
      reason: checks.reason,
    });
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_verification",
    };
  }

  if (!order.posSpotId) {
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_ineligible",
    };
  }

  await expireStalePaymentHold(order.posSpotId);
  const orderAfterExpiry = await getOrderByCheckoutSessionId(verified.lowProfileId);
  if (!orderAfterExpiry) {
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_unknown",
    };
  }
  if (orderAfterExpiry.orderStatus === "cancelled") {
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_cancelled",
    };
  }
  if (isVerifiedPaidOrderStatus(orderAfterExpiry.orderStatus)) {
    await runPostPaymentDocumentEmail(orderAfterExpiry.orderId, deps);
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "already_finalized",
    };
  }
  if (orderAfterExpiry.orderStatus !== "pending_payment") {
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_ineligible",
    };
  }

  const posSpot = await getPosSpotById(orderAfterExpiry.posSpotId ?? order.posSpotId);
  if (!posSpot || posSpot.status !== "held_for_payment") {
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_ineligible",
    };
  }

  const cardcomTransactionId = resolveVerifiedTransactionId(verified);

  try {
    const finalized = await finalizeVerifiedPendingPaymentAtomic({
      orderId: orderAfterExpiry.orderId,
      checkoutSessionId: verified.lowProfileId,
      posSpotId: orderAfterExpiry.posSpotId!,
      fulfillmentMethod: orderAfterExpiry.fulfillmentMethod,
      cardcomTransactionId,
    });

    if (!finalized.ok) {
      const again = await getOrderByCheckoutSessionId(verified.lowProfileId);
      if (
        again &&
        isVerifiedPaidOrderStatus(again.orderStatus) &&
        again.checkoutSessionId === verified.lowProfileId
      ) {
        await runPostPaymentDocumentEmail(again.orderId, deps);
        return {
          httpStatus: 200,
          body: { ok: true },
          outcome: "already_finalized",
        };
      }
      return {
        httpStatus: 200,
        body: { ok: true },
        outcome: "ignored_ineligible",
      };
    }

    logWebhookOp("finalized", {
      orderId: order.orderId,
      lowProfileId: verified.lowProfileId,
      orderStatus: finalized.order.orderStatus,
      posSpotId: order.posSpotId,
      posStatus: "sold",
      cardcomEnvironment,
      cardcomTransactionId: cardcomTransactionId ?? null,
    });

    await runPostPaymentDocumentEmail(finalized.order.orderId, deps);

    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "finalized",
    };
  } catch {
    return {
      httpStatus: 500,
      body: { ok: false, error: "Internal error" },
      outcome: "server_error",
    };
  }
}

/**
 * Process a Cardcom LowProfile JSON webhook body.
 * Lookup: payment_attempt by LowProfileId first, then legacy pending Order.
 */
export async function processCardcomWebhook(
  body: unknown,
  deps: ProcessCardcomWebhookDeps = {},
): Promise<ProcessCardcomWebhookResult> {
  const parsed = parseCardcomWebhookLowProfileResult(body);
  if (!parsed) {
    logWebhookOp("missing_or_invalid_LowProfileId", {});
    return {
      httpStatus: 400,
      body: { ok: false, error: "Invalid webhook payload" },
      outcome: "bad_request",
    };
  }

  const { lowProfileId } = parsed;

  const attempt = await getPaymentAttemptByCheckoutSessionId(lowProfileId);
  if (attempt) {
    return processAttemptWebhook(lowProfileId, attempt, deps);
  }

  const order = await getOrderByCheckoutSessionId(lowProfileId);
  if (!order) {
    logWebhookOp("orphan_or_unknown_low_profile", { lowProfileId });
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_unknown",
    };
  }

  return processLegacyOrderWebhook(lowProfileId, order, deps);
}
