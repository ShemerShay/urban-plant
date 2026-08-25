"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePostHog } from "posthog-js/react";

import { CheckoutCustomerFields } from "@/components/checkout/CheckoutCustomerFields";
import {
  DeliveryAddressFields,
  type DeliveryAddressFieldErrors,
  type DeliveryAddressFieldValues,
} from "@/components/checkout/DeliveryAddressFields";
import { useLocale } from "@/components/locale/LocaleProvider";
import {
  ANALYTICS_EVENTS,
  captureAnalyticsEvent,
  type AnalyticsCommerceProps,
} from "@/lib/analyticsEvents";
import {
  canSubmitCheckout,
  getCheckoutFieldErrors,
  getVisibleCheckoutFieldErrors,
  type CheckoutFieldKey,
  type CheckoutFulfillmentMethod,
} from "@/lib/checkoutValidation";
import {
  defaultCheckoutFulfillment,
  hideCheckoutPickupOption,
  isCheckoutDeliveryDisabled,
} from "@/lib/checkoutFulfillment";
import type { InventoryType } from "@/lib/inventoryType";
import { displayApiError, translateCheckoutFieldErrors } from "@/lib/displayLabels";
import { t } from "@/lib/messages";
import { isPosSpotPurchasable, shouldShowHeldForPaymentCheckoutMessage } from "@/lib/posSpotHold";
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
  inventoryType: InventoryType;
  /** When true, pickup is hidden and only delivery is available (plants only). */
  pickupDisabled?: boolean;
  /** Latest POS inventory status from the server (page load). */
  posSpotStatus: PosSpotStatus;
  /**
   * Cardcom fail/cancel return for the same pending order (resume token holder).
   * When set, submit retries Cardcom for that order instead of creating a new sale.
   */
  paymentResume?: PaymentResumeProps;
  /** Optional commerce context for `payment_started` (analytics only). */
  analyticsContext?: AnalyticsCommerceProps;
}

const FIELD_FOCUS_ORDER: CheckoutFieldKey[] = [
  "fullName",
  "email",
  "phone",
  "deliveryStreet",
  "deliveryHouseNumber",
];

const FIELD_ELEMENT_IDS: Record<CheckoutFieldKey, string> = {
  fullName: "fullName",
  email: "email",
  phone: "phone",
  deliveryStreet: "deliveryStreet",
  deliveryHouseNumber: "deliveryHouseNumber",
};

const buttonFocusClass =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700/55 focus-visible:ring-offset-2";

export function CheckoutForm({
  plantId,
  plantName,
  priceDisplay,
  spotSlug,
  inventoryType,
  pickupDisabled = false,
  posSpotStatus,
  paymentResume,
  analyticsContext,
}: CheckoutFormProps) {
  const posthog = usePostHog();
  const locale = useLocale();
  const resumeHolder = Boolean(paymentResume);
  const deliveryDisabled = isCheckoutDeliveryDisabled(inventoryType);
  const hidePickup = hideCheckoutPickupOption(inventoryType, pickupDisabled);
  const formHeadingId = useId();
  const statusRegionId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [fulfillmentMethod, setFulfillmentMethod] = useState<FulfillmentMethod>(
    defaultCheckoutFulfillment({
      inventoryType,
      pickupDisabled,
      resumeFulfillment: paymentResume?.prefill.fulfillmentMethod,
    }),
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
    paymentResume?.showPaymentFailedMessage ? t(locale, "checkout.paymentFailed") : null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationSummary, setValidationSummary] = useState<string | null>(null);

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
    setValidationSummary(null);
  }

  function handleFulfillmentChange(next: FulfillmentMethod) {
    if (hidePickup && next === "pickup") {
      return;
    }
    if (deliveryDisabled && next === "delivery") {
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
    setValidationSummary(null);
  }

  function focusFirstInvalidField(nextErrors: Partial<Record<CheckoutFieldKey, string>>) {
    for (const key of FIELD_FOCUS_ORDER) {
      if (!nextErrors[key]) continue;
      if (fulfillmentMethod === "pickup" && (key === "deliveryStreet" || key === "deliveryHouseNumber")) {
        continue;
      }
      const el = document.getElementById(FIELD_ELEMENT_IDS[key]);
      if (el instanceof HTMLElement) {
        el.focus();
        return;
      }
    }
  }

  function revealValidationErrors() {
    setShowAllErrors(true);
    const nextErrors = getCheckoutFieldErrors(fields, fulfillmentMethod);
    const count = Object.keys(nextErrors).length;
    setValidationSummary(
      count > 0
        ? count === 1
          ? t(locale, "checkout.validation.summaryOne")
          : t(locale, "checkout.validation.summaryMany", { count })
        : null,
    );
    window.setTimeout(() => focusFirstInvalidField(nextErrors), 0);
  }

  const fieldErrors = getCheckoutFieldErrors(fields, fulfillmentMethod);
  const errors = translateCheckoutFieldErrors(
    locale,
    getVisibleCheckoutFieldErrors(fieldErrors, touched, showAllErrors),
  );
  const canSubmit = canSubmitCheckout(fields, fulfillmentMethod);
  const purchaseAllowed = isPosSpotPurchasable(posSpotStatus, { resumeHolder });
  const showHeldCheckoutMessage = shouldShowHeldForPaymentCheckoutMessage(posSpotStatus, {
    resumeHolder,
  });
  /** Resume retry uses orderId + token only — do not gate on form canSubmit. */
  const isResumeRetry = Boolean(paymentResume);

  useEffect(() => {
    if (paymentFailedMessage) {
      document.getElementById(statusRegionId)?.focus();
    }
  }, [paymentFailedMessage, statusRegionId]);

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
    setValidationSummary(null);

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
          attemptId?: string;
          orderId?: string;
        };
        if (!response.ok || !data.paymentUrl) {
          setSubmitError(
            displayApiError(locale, data.error, "checkout.error.restartPayment"),
          );
          return;
        }
        captureAnalyticsEvent(posthog, ANALYTICS_EVENTS.paymentStarted, {
          ...analyticsContext,
          plant_id: plantId,
          plant_name: analyticsContext?.plant_name,
          spot_slug: spotSlug,
          fulfillment_method: fulfillmentMethod,
          attempt_id: data.attemptId || data.orderId || paymentResume.orderId,
        });
        window.location.assign(data.paymentUrl);
        return;
      }

      // First attempt: payment_attempt (+ plant POS hold) + Cardcom Create → hosted page.
      // Flowers skip the hold. Browser never finalizes; webhook creates the Order.
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
        attemptId?: string;
        orderId?: string;
      };

      if (!response.ok || !data.paymentUrl) {
        setSubmitError(displayApiError(locale, data.error, "checkout.error.startPayment"));
        return;
      }

      captureAnalyticsEvent(posthog, ANALYTICS_EVENTS.paymentStarted, {
        ...analyticsContext,
        plant_id: plantId,
        plant_name: analyticsContext?.plant_name,
        spot_slug: spotSlug,
        fulfillment_method: fulfillmentMethod,
        attempt_id: data.attemptId || data.orderId,
      });
      window.location.assign(data.paymentUrl);
    } catch {
      setSubmitError(t(locale, "common.networkError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  const isSubmitDisabled =
    isSubmitting || !purchaseAllowed || (!isResumeRetry && !canSubmit);

  const deliveryErrors: DeliveryAddressFieldErrors = {
    deliveryStreet: errors.deliveryStreet,
    deliveryHouseNumber: errors.deliveryHouseNumber,
  };

  return (
    <form
      id="checkout-form"
      ref={formRef}
      onSubmit={onSubmit}
      className="space-y-4"
      aria-labelledby={formHeadingId}
      aria-busy={isSubmitting || undefined}
      noValidate
    >
      <h2 id={formHeadingId} className="text-xl font-semibold text-emerald-950">
        {fulfillmentMethod === "delivery"
          ? t(locale, "checkout.details.delivery")
          : t(locale, "checkout.details.pickup")}
      </h2>

      <fieldset className="space-y-2">
        <legend className="sr-only">{t(locale, "checkout.fulfillment.legend")}</legend>
        <div className={hidePickup ? "" : "grid grid-cols-2 gap-2"} role="group">
          <button
            type="button"
            aria-pressed={fulfillmentMethod === "delivery"}
            disabled={deliveryDisabled || undefined}
            aria-disabled={deliveryDisabled || undefined}
            onClick={() => handleFulfillmentChange("delivery")}
            className={`min-h-12 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${buttonFocusClass} ${
              deliveryDisabled
                ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                : fulfillmentMethod === "delivery"
                  ? "border-emerald-700 bg-emerald-50 text-emerald-900"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
            }`}
          >
            {t(locale, "checkout.fulfillment.delivery")}
          </button>
          {!hidePickup ? (
            <button
              type="button"
              aria-pressed={fulfillmentMethod === "pickup"}
              onClick={() => handleFulfillmentChange("pickup")}
              className={`min-h-12 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${buttonFocusClass} ${
                fulfillmentMethod === "pickup"
                  ? "border-emerald-700 bg-emerald-50 text-emerald-900"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
              }`}
            >
              {t(locale, "checkout.fulfillment.pickup")}
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
          {deliveryDisabled ? (
            t(locale, "checkout.confirm.flowersPickup")
          ) : (
            <>
              {t(locale, "checkout.confirm.prefix")}
              <span className="font-semibold">{plantName}</span>
              {fulfillmentMethod === "delivery"
                ? t(locale, "checkout.confirm.deliverySuffix")
                : t(locale, "checkout.confirm.pickupSuffix")}
            </>
          )}
        </p>
      </div>

      <div
        id={statusRegionId}
        tabIndex={-1}
        className="space-y-2 outline-none"
        aria-live="assertive"
        aria-atomic="true"
      >
        {paymentFailedMessage ? (
          <p className="text-sm font-medium text-red-800">{paymentFailedMessage}</p>
        ) : null}
        {validationSummary ? (
          <p className="text-sm font-medium text-red-800">{validationSummary}</p>
        ) : null}
        {submitError ? <p className="text-sm text-red-700">{submitError}</p> : null}
        {prepMessage ? <p className="text-sm text-emerald-800">{prepMessage}</p> : null}
      </div>

      <div>
        {showHeldCheckoutMessage ? (
          <p className="mb-3 text-sm leading-5 text-amber-950" role="status">
            {t(locale, "plant.held.checkout")}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={isSubmitDisabled}
          aria-disabled={isSubmitDisabled || undefined}
          className={`min-h-12 w-full rounded-2xl bg-emerald-700 px-5 py-4 text-sm font-semibold text-white transition enabled:hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-500 disabled:opacity-60 ${buttonFocusClass}`}
        >
          {isSubmitting
            ? t(locale, "checkout.processing")
            : deliveryDisabled
              ? t(locale, "checkout.submitWithPrice", { price: priceDisplay })
              : t(locale, "checkout.submit")}
        </button>
        {isSubmitting ? (
          <p className="sr-only" role="status" aria-live="polite">
            {t(locale, "checkout.processingSr")}
          </p>
        ) : null}
      </div>
    </form>
  );
}
