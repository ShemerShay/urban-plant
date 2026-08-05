"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CustomerRecoveryActions } from "@/components/customer/CustomerRecoveryActions";
import {
  PAYMENT_STATUS_POLL_MS,
  isPaymentStatusPollTimedOut,
  parseOrderIdQueryParam,
  paymentCompletedRedirectPath,
  paymentVerificationRedirectPath,
  shouldContinuePaymentStatusPolling,
  type CardcomPaymentStatusResponse,
} from "@/lib/cardcomPaymentStatus";
import { isPaymentResumeTokenShape } from "@/lib/paymentResume";
import { routes } from "@/lib/routes";

type UiMode = "invalid" | "verifying" | "timeout" | "cancelled_unavailable";

async function fetchPaymentStatus(
  orderId: string,
): Promise<CardcomPaymentStatusResponse> {
  const res = await fetch(routes.api.cardcomStatus(orderId), {
    method: "GET",
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as CardcomPaymentStatusResponse | null;
  if (!data || typeof data !== "object" || typeof data.state !== "string") {
    return { state: "pending" };
  }
  return data;
}

interface PaymentVerificationClientProps {
  orderIdRaw: string | null;
  resumeTokenRaw: string | null;
}

/**
 * Temporary Cardcom return waiter. Final confirmation is always `/success`.
 * Cancelled payments return to the same checkout (not a standalone failed page).
 */
export function PaymentVerificationClient({
  orderIdRaw,
  resumeTokenRaw,
}: PaymentVerificationClientProps) {
  const router = useRouter();
  const orderId = parseOrderIdQueryParam(orderIdRaw);
  const resumeToken = isPaymentResumeTokenShape(resumeTokenRaw)
    ? resumeTokenRaw.trim()
    : null;
  const [mode, setMode] = useState<UiMode>(orderId ? "verifying" : "invalid");
  const [pollSession, setPollSession] = useState(0);
  const startedAtRef = useRef<number>(Date.now());
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (!orderId) {
      setMode("invalid");
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    redirectedRef.current = false;
    startedAtRef.current = Date.now();
    setMode("verifying");

    async function tick() {
      if (cancelled || redirectedRef.current) return;

      if (isPaymentStatusPollTimedOut(startedAtRef.current, Date.now())) {
        setMode("timeout");
        return;
      }

      const status = await fetchPaymentStatus(orderId!);
      if (cancelled || redirectedRef.current) return;

      if (status.state === "completed") {
        redirectedRef.current = true;
        router.replace(paymentCompletedRedirectPath(status.orderId));
        return;
      }

      if (status.state === "cancelled") {
        const path = paymentVerificationRedirectPath(status, {
          orderId,
          resumeToken,
        });
        if (path) {
          redirectedRef.current = true;
          router.replace(path);
          return;
        }
        setMode("cancelled_unavailable");
        return;
      }

      if (
        status.state === "pending" ||
        status.state === "not_found" ||
        shouldContinuePaymentStatusPolling(status)
      ) {
        setMode("verifying");
      }

      timeoutId = setTimeout(() => {
        void tick();
      }, PAYMENT_STATUS_POLL_MS);
    }

    void tick();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [orderId, resumeToken, router, pollSession]);

  function checkAgain() {
    if (!orderId) return;
    setPollSession((n) => n + 1);
  }

  const title =
    mode === "invalid"
      ? "We couldn’t verify this payment"
      : mode === "timeout"
        ? "Payment verification is taking longer than expected"
        : mode === "cancelled_unavailable"
          ? "Payment wasn’t completed"
          : "Verifying your payment";

  const description =
    mode === "invalid"
      ? "This page is only a temporary return from payment. If you completed a purchase, message Urban Plant on WhatsApp and we’ll help."
      : mode === "timeout"
        ? "Your payment may still be processing. You can check again or contact Urban Plant."
        : mode === "cancelled_unavailable"
          ? "התשלום נכשל. אפשר לנסות שוב דרך עמוד הצמח או ליצור קשר עם Urban Plant."
          : "We received your payment request and are waiting for final confirmation. This usually takes a few moments.";

  return (
    <main
      id="payment-success-page"
      className="bg-background text-foreground mx-auto flex min-h-screen w-full max-w-md flex-col px-6 py-10"
    >
      <div className="flex-1 space-y-6">
        <section className="rounded-3xl bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
          <p className="font-serif-display text-xl font-medium tracking-tight text-neutral-900">
            UrbanPlant
          </p>
          <h1 className="mt-3 text-3xl font-semibold text-emerald-950">{title}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
          {mode === "timeout" ? (
            <button
              type="button"
              onClick={checkAgain}
              className="mt-6 w-full rounded-2xl bg-emerald-700 px-5 py-4 text-sm font-semibold text-white transition hover:bg-emerald-600"
            >
              Check again
            </button>
          ) : null}
          <CustomerRecoveryActions
            className="mt-6"
            whatsAppMessage={
              orderId
                ? `Hi Urban Plant — I’m waiting on payment verification for order ${orderId}.`
                : "Hi Urban Plant — I returned from payment and need help verifying my order."
            }
            returnLabel="Return to previous page"
          />
        </section>
      </div>
    </main>
  );
}
