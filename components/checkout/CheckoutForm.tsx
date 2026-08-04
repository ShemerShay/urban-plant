"use client";

import { useRouter } from "next/navigation";
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
import type { PosSpotStatus } from "@/lib/posSpotTypes";
import { routes } from "@/lib/routes";
type FormFields = {
  fullName: string;
  email: string;
  phone: string;
} & DeliveryAddressFieldValues;

type FulfillmentMethod = CheckoutFulfillmentMethod;

interface CheckoutFormProps {
  plantId: string;
  plantName: string;
  /** Formatted price line for confirmation email (e.g. ₪89) */
  priceDisplay: string;
  /** POS Spot slug from `/checkout/pos/{spotSlug}`. */
  spotSlug: string;
  /** When true, pickup is hidden and only delivery is available. */
  pickupDisabled?: boolean;
  /** Latest POS inventory status from the server (page load). */
  posSpotStatus: PosSpotStatus;
}

export function CheckoutForm({
  plantId,
  plantName,
  priceDisplay,
  spotSlug,
  pickupDisabled = false,
  posSpotStatus,
}: CheckoutFormProps) {
  const router = useRouter();
  const [fulfillmentMethod, setFulfillmentMethod] =
    useState<FulfillmentMethod>("delivery");
  const [fields, setFields] = useState<FormFields>({
    fullName: "",
    email: "",
    phone: "05",
    deliveryStreet: "",
    deliveryHouseNumber: "",
    apartmentOrNotes: "",
  });
  const [touched, setTouched] = useState<Partial<Record<CheckoutFieldKey, boolean>>>({});
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [prepMessage, setPrepMessage] = useState<string | null>(null);
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
  const purchaseAllowed = isPosSpotPurchasable(posSpotStatus);
  const showHeldCheckoutMessage = shouldShowHeldForPaymentCheckoutMessage(posSpotStatus);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!purchaseAllowed) {
      return;
    }
    if (!canSubmit) {
      revealValidationErrors();
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setPrepMessage(null);

    const orderId = crypto.randomUUID();

    try {
      const response = await fetch(routes.api.orders(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
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
      };

      if (!response.ok) {
        setSubmitError(data.error ?? "Could not save order. Try again.");
        return;
      }

      const customerEmail = fields.email.trim();
      const fullName = fields.fullName.trim();
      let emailFailed = false;
      try {
        const emailResponse = await fetch(routes.api.sendPurchaseEmail(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerEmail,
            fullName,
            plantName,
            priceDisplay,
            fulfillmentMethod,
          }),
        });
        if (!emailResponse.ok) {
          emailFailed = true;
        }
      } catch {
        emailFailed = true;
      }

      router.replace(
        routes.customer.success({
          orderId,
          plantId,
          plantName,
          spotSlug,
          fulfillmentMethod,
          ...(emailFailed ? { emailFailed: "1" } : {}),
        }),
      );

      // TODO(payment): move completed order creation to provider confirmation/webhook.
    } catch {
      setSubmitError("Network error. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const isSubmitDisabled = isSubmitting || !canSubmit || !purchaseAllowed;
  const showValidationOverlay = !isSubmitting && purchaseAllowed && !canSubmit;

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
