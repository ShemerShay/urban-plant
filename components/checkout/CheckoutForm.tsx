"use client";

import { useState } from "react";

import { CheckoutCustomerFields } from "@/components/checkout/CheckoutCustomerFields";
import {
  DeliveryAddressFields,
  type DeliveryAddressFieldErrors,
  type DeliveryAddressFieldValues,
} from "@/components/checkout/DeliveryAddressFields";
import {
  canSubmitCheckout,
  getCheckoutFieldErrors,
  getVisibleCheckoutFieldErrors,
  type CheckoutFieldKey,
  type CheckoutFulfillmentMethod,
} from "@/lib/checkoutValidation";
import {
  POS_HELD_FOR_PAYMENT_CHECKOUT_MESSAGE,
  isPosSpotPurchasable,
  shouldShowHeldForPaymentCheckoutMessage,
} from "@/lib/posSpotHold";
import { PAYMENT_FAILED_CHECKOUT_MESSAGE } from "@/lib/paymentResumeToken";
import type { PosSpotStatus } from "@/lib/posSpotTypes";
import { routes } from "@/lib/routes";
type FormFields = {
  fullName: string;
  email: string;
  phone: string;
} & DeliveryAddressFieldValues;

type FulfillmentMethod = CheckoutFulfillmentMethod;

type PaymentResumeProps = {
  orderId: string;
  resumeToken: string;
  showPaymentFailedMessage: boolean;
  prefill: {
    fullName: string;
    email: string;
    phone: string;
    fulfillmentMethod: FulfillmentMethod;
    deliveryStreet?: string;
    deliveryHouseNumber?: string;
    apartmentOrNotes?: string;
  };
};

interface CheckoutFormProps {
  plantId: string;
  plantName: string;
  /** Formatted price line (kept for callers; confirmation email is post-webhook). */
  priceDisplay: string;
  /** POS Spot slug from `/checkout/pos/{spotSlug}`. */
  spotSlug: string;
  /** When true, pickup is hidden and only delivery is available. */
  pickupDisabled?: boolean;
  /** Latest POS inventory status from the server (page load). */
  posSpotStatus: PosSpotStatus;
  /**
   * Cardcom fail/cancel return for the same pending order (resume token holder).
   * When set, submit retries Cardcom for that order instead of creating a new sale.
   */
  paymentResume?: PaymentResumeProps;
}

export function CheckoutForm({
  plantId,
  plantName,
  priceDisplay: _priceDisplay,
  spotSlug,
  pickupDisabled = false,
  posSpotStatus,
  paymentResume,
}: CheckoutFormProps) {
  const resumeHolder = Boolean(paymentResume);
  const [fulfillmentMethod, setFulfillmentMethod] = useState<FulfillmentMethod>(
    paymentResume?.prefill.fulfillmentMethod === "pickup" && !pickupDisabled
      ? "pickup"
      : "delivery",
  );
  const [fields, setFields] = useState<FormFields>({
    fullName: paymentResume?.prefill.fullName ?? "",
    email: paymentResume?.prefill.email ?? "",
    phone: paymentResume?.prefill.phone || "05",
    deliveryStreet: paymentResume?.prefill.deliveryStreet ?? "",
    deliveryHouseNumber: paymentResume?.prefill.deliveryHouseNumber ?? "",
    apartmentOrNotes: paymentResume?.prefill.apartmentOrNotes ?? "",
  });
  const [touched, setTouched] = useState<Partial<Record<CheckoutFieldKey, boolean>>>({});
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [prepMessage, setPrepMessage] = useState<string | null>(null);
  const [paymentFailedMessage] = useState(
    paymentResume?.showPaymentFailedMessage ? PAYMENT_FAILED_CHECKOUT_MESSAGE : null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  function markTouched(field: CheckoutFieldKey) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function handleChange(field: keyof FormFields, value: string) {
    setFields((prev) => ({ ...prev, [field]: value }));
    if (field !== "apartmentOrNotes") {
      markTouched(field);
    }
    setSubmitError(null);
    setPrepMessage(null);
  }

  function handleFulfillmentChange(next: FulfillmentMethod) {
    if (pickupDisabled && next === "pickup") {
      return;
    }
    setFulfillmentMethod(next);
    if (next === "pickup") {
      setTouched((prev) => {
        const {
          deliveryStreet: _s,
          deliveryHouseNumber: _h,
          ...rest
        } = prev;
        return rest;
      });
    }
    setSubmitError(null);
    setPrepMessage(null);
  }

  function revealValidationErrors() {
    setShowAllErrors(true);
  }

  const fieldErrors = getCheckoutFieldErrors(fields, fulfillmentMethod);
  const errors = getVisibleCheckoutFieldErrors(fieldErrors, touched, showAllErrors);
  const canSubmit = canSubmitCheckout(fields, fulfillmentMethod);
  const purchaseAllowed = isPosSpotPurchasable(posSpotStatus, { resumeHolder });
  const showHeldCheckoutMessage = shouldShowHeldForPaymentCheckoutMessage(posSpotStatus, {
    resumeHolder,
  });
  /** Resume retry uses orderId + token only — do not gate on form canSubmit. */
  const isResumeRetry = Boolean(paymentResume);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!purchaseAllowed) {
      return;
    }
    if (!isResumeRetry && !canSubmit) {
      revealValidationErrors();
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setPrepMessage(null);

    try {
      // Resume holder: retry Cardcom on the same pending order (no new order).
      if (paymentResume) {
        const response = await fetch(routes.api.cardcomRetry(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: paymentResume.orderId,
            resumeToken: paymentResume.resumeToken,
          }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          paymentUrl?: string;
        };
        if (!response.ok || !data.paymentUrl) {
          setSubmitError(data.error ?? "Could not restart payment. Try again.");
          return;
        }
        window.location.assign(data.paymentUrl);
        return;
      }

      // First attempt: pending_payment + hold + Cardcom Create → hosted payment page.
      // Browser never finalizes; webhook + GetLpResult mark sold/picked_up and send email.
      const response = await fetch(routes.api.cardcomCreate(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plantId,
          spotSlug,
          fulfillmentMethod,
          fullName: fields.fullName.trim(),
          customerEmail: fields.email.trim(),
          phone: fields.phone.trim(),
          ...(fulfillmentMethod === "delivery"
            ? {
                deliveryStreet: fields.deliveryStreet.trim(),
                deliveryHouseNumber: fields.deliveryHouseNumber.trim(),
                apartmentOrNotes: fields.apartmentOrNotes.trim(),
              }
            : {}),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        paymentUrl?: string;
      };

      if (!response.ok || !data.paymentUrl) {
        setSubmitError(data.error ?? "Could not start payment. Try again.");
        return;
      }

      window.location.assign(data.paymentUrl);
    } catch {
      setSubmitError("Network error. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const isSubmitDisabled =
    isSubmitting || !purchaseAllowed || (!isResumeRetry && !canSubmit);
  const showValidationOverlay =
    !isResumeRetry && !isSubmitting && purchaseAllowed && !canSubmit;

  const deliveryErrors: DeliveryAddressFieldErrors = {
    deliveryStreet: errors.deliveryStreet,
    deliveryHouseNumber: errors.deliveryHouseNumber,
  };

  return (
    <form id="checkout-form" onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-xl font-semibold text-emerald-950">
        {fulfillmentMethod === "delivery" ? "Delivery details" : "Pickup details"}
      </h2>

      <fieldset className="space-y-2">
        <div className={pickupDisabled ? "" : "grid grid-cols-2 gap-2"}>
          <button
            type="button"
            aria-pressed={fulfillmentMethod === "delivery"}
            onClick={() => handleFulfillmentChange("delivery")}
            className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
              fulfillmentMethod === "delivery"
                ? "border-emerald-700 bg-emerald-50 text-emerald-900"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
            }`}
          >
            Delivery
          </button>
          {!pickupDisabled ? (
            <button
              type="button"
              aria-pressed={fulfillmentMethod === "pickup"}
              onClick={() => handleFulfillmentChange("pickup")}
              className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                fulfillmentMethod === "pickup"
                  ? "border-emerald-700 bg-emerald-50 text-emerald-900"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
              }`}
            >
              Pickup
            </button>
          ) : null}
        </div>
      </fieldset>

      <CheckoutCustomerFields
        values={{
          fullName: fields.fullName,
          email: fields.email,
          phone: fields.phone,
        }}
        errors={{
          fullName: errors.fullName,
          email: errors.email,
          phone: errors.phone,
        }}
        onChange={handleChange}
        onFieldBlur={markTouched}
      />

      {fulfillmentMethod === "delivery" ? (
        <DeliveryAddressFields
          values={{
            deliveryStreet: fields.deliveryStreet,
            deliveryHouseNumber: fields.deliveryHouseNumber,
            apartmentOrNotes: fields.apartmentOrNotes,
          }}
          errors={deliveryErrors}
          onChange={handleChange}
          onFieldBlur={markTouched}
        />
      ) : null}

      <div className="rounded-2xl bg-emerald-50/80 p-4">
        <p className="text-sm text-emerald-900">
          Completing this order confirms purchase for{" "}
          <span className="font-semibold">{plantName}</span>{" "}
          {fulfillmentMethod === "delivery"
            ? ". Delivery takes 1–3 business days."
            : "immediate pickup."}
        </p>
      </div>

      {paymentFailedMessage ? (
        <p className="text-sm font-medium text-red-700">{paymentFailedMessage}</p>
      ) : null}
      {submitError ? <p className="text-sm text-red-600">{submitError}</p> : null}
      {prepMessage ? <p className="text-sm text-emerald-800">{prepMessage}</p> : null}

      <div>
        {showHeldCheckoutMessage ? (
          <p className="mb-3 text-sm leading-5 text-amber-900">
            {POS_HELD_FOR_PAYMENT_CHECKOUT_MESSAGE}
          </p>
        ) : null}
        <div className="relative">
          {showValidationOverlay ? (
            <button
              type="button"
              tabIndex={-1}
              aria-label="Show what is required to complete your order"
              className="absolute inset-0 z-10 cursor-not-allowed rounded-2xl"
              onClick={revealValidationErrors}
            />
          ) : null}
          <button
            type="submit"
            disabled={isSubmitDisabled}
            className="w-full rounded-2xl bg-emerald-700 px-5 py-4 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-500 disabled:hover:bg-neutral-300"
          >
            {isSubmitting ? "Processing…" : "Complete Order"}
          </button>
        </div>
      </div>
    </form>
  );
}
