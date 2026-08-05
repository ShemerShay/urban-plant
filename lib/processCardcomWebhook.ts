/**
 * Cardcom webhook → GetLpResult verification → conditional order/POS finalization.
 * After successful payment finalization, runs non-blocking document + email processing.
 * Document/email failures never undo payment or POS.
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
  /**
   * Injected GetLpResult. Defaults to real getCardcomLowProfileResult.
   * Environment comes from the order's stored cardcom_env (test vs production).
   */
  getLpResult?: (
    lowProfileId: string,
    environment: CardcomEnvironment,
  ) => Promise<CardcomLowProfileResult>;
  /** Injected post-payment document/email (tests). */
  processDocumentAndEmail?: (
    orderId: string,
  ) => Promise<unknown>;
  documentEmailDeps?: ProcessOrderDocumentAndEmailDeps;
};

export type ProcessCardcomWebhookResult = {
  httpStatus: number;
  body: { ok: true } | { ok: false; error: string };
  /** Sanitized outcome for tests / ops (never includes Cardcom secrets). */
  outcome:
    | "finalized"
    | "already_finalized"
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

function resolveOrderCardcomEnv(order: SavedOrder): CardcomEnvironment {
  return isCardcomEnvironment(order.cardcomEnv) ? order.cardcomEnv : "production";
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

/**
 * Process a Cardcom LowProfile JSON webhook body (Swagger: LowProfileResult).
 * Looks up the order by LowProfileId first (to learn test vs production),
 * then verifies via GetLpResult before any finalization.
 * Webhook ResponseCode / Amount / ReturnValue / TranzactionInfo are not trusted.
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

  // Resolve Cardcom environment from the order that owns this LowProfileId.
  const orderBeforeVerify = await getOrderByCheckoutSessionId(lowProfileId);
  if (!orderBeforeVerify) {
    logWebhookOp("orphan_or_unknown_low_profile", { lowProfileId });
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_unknown",
    };
  }

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
      // Safe retry of document/email without re-finalizing payment/POS.
      await runPostPaymentDocumentEmail(orderBeforeVerify.orderId, deps);
      return {
        httpStatus: 200,
        body: { ok: true },
        outcome: "already_finalized",
      };
    }
    logWebhookOp("paid_order_session_mismatch", {
      orderId: orderBeforeVerify.orderId,
      lowProfileId,
    });
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_ineligible",
    };
  }

  if (orderBeforeVerify.orderStatus !== "pending_payment") {
    logWebhookOp("order_not_pending", {
      orderId: orderBeforeVerify.orderId,
      orderStatus: orderBeforeVerify.orderStatus,
    });
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

  const getLpResult =
    deps.getLpResult ??
    ((id: string, environment: CardcomEnvironment) =>
      getCardcomLowProfileResult({ lowProfileId: id }, { environment }));

  let verified: CardcomLowProfileResult;
  try {
    verified = await getLpResult(lowProfileId, cardcomEnvironment);
  } catch (error) {
    if (error instanceof CardcomError) {
      if (
        error.code === "network" ||
        error.code === "http" ||
        error.code === "config"
      ) {
        logWebhookOp("get_lp_result_upstream_failure", {
          lowProfileId,
          orderId: orderBeforeVerify.orderId,
          code: error.code,
          cardcomEnvironment,
        });
        return {
          httpStatus: 502,
          body: { ok: false, error: "Payment verification temporarily unavailable" },
          outcome: "upstream_error",
        };
      }
      logWebhookOp("get_lp_result_not_successful", {
        lowProfileId,
        orderId: orderBeforeVerify.orderId,
        code: error.code,
        responseCode: error.responseCode ?? null,
        cardcomEnvironment,
      });
      return {
        httpStatus: 200,
        body: { ok: true },
        outcome: "ignored_verification",
      };
    }
    logWebhookOp("get_lp_result_unexpected_error", {
      lowProfileId,
      orderId: orderBeforeVerify.orderId,
    });
    return {
      httpStatus: 500,
      body: { ok: false, error: "Internal error" },
      outcome: "server_error",
    };
  }

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

  // Re-load after GetLpResult in case of concurrent webhook.
  const order = await getOrderByCheckoutSessionId(verified.lowProfileId);
  if (!order) {
    logWebhookOp("orphan_or_unknown_low_profile", {
      lowProfileId: verified.lowProfileId,
    });
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_unknown",
    };
  }

  if (order.orderStatus === "cancelled") {
    logWebhookOp("order_cancelled_skip_finalize", {
      orderId: order.orderId,
      lowProfileId: verified.lowProfileId,
    });
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
    logWebhookOp("order_missing_pos", { orderId: order.orderId });
    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "ignored_ineligible",
    };
  }

  // Abandoned holds expire after 17 minutes — late webhooks must fail closed.
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
    logWebhookOp("order_cancelled_after_hold_expiry", {
      orderId: orderAfterExpiry.orderId,
      lowProfileId: verified.lowProfileId,
    });
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
    logWebhookOp("pos_not_held", {
      orderId: orderAfterExpiry.orderId,
      posSpotId: orderAfterExpiry.posSpotId ?? null,
      posStatus: posSpot?.status ?? null,
    });
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
      logWebhookOp("finalize_conflict", {
        orderId: order.orderId,
        lowProfileId: verified.lowProfileId,
      });
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

    // Payment/POS are committed. Document/email failures must not change HTTP outcome.
    await runPostPaymentDocumentEmail(finalized.order.orderId, deps);

    return {
      httpStatus: 200,
      body: { ok: true },
      outcome: "finalized",
    };
  } catch {
    logWebhookOp("finalize_threw", {
      orderId: order.orderId,
      lowProfileId: verified.lowProfileId,
    });
    return {
      httpStatus: 500,
      body: { ok: false, error: "Internal error" },
      outcome: "server_error",
    };
  }
}
