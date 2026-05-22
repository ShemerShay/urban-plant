"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
import { normalizeIsraeliMobilePhoneInput } from "@/lib/formValidation";
import type { PlantCatalogStatus } from "@/lib/types";

type FormFields = {
  fullName: string;
  email: string;
  phone: string;
} & DeliveryAddressFieldValues;

type FulfillmentMethod = CheckoutFulfillmentMethod;

interface CheckoutFormProps {
  plantId: string;
  plantName: string;
  /** Catalog availability; when `sold`, the submit control stays disabled like other blocked purchases. */
  plantStatus: PlantCatalogStatus;
  /** Formatted price line for confirmation email (e.g. ₪89) */
  priceDisplay: string;
  /** POS Spot slug from `/checkout/pos/{spotSlug}`. */
  spotSlug: string;
}

const baseInputClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60";

export function CheckoutForm({
  plantId,
  plantName,
  plantStatus,
  priceDisplay: _priceDisplay,
  spotSlug,
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

  void _priceDisplay;

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

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (plantStatus === "sold") return;
    if (!canSubmit) {
      revealValidationErrors();
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setPrepMessage(null);

    const orderId = crypto.randomUUID();

    try {
      const response = await fetch("/api/orders", {
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

      const successParams = new URLSearchParams({
        orderId,
        plantId,
        plantName,
        fulfillmentMethod,
      });
      router.replace(`/success?${successParams.toString()}`);

      // TODO(payment): move completed order creation to provider confirmation/webhook.
    } catch {
      setSubmitError("Network error. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const isSubmitDisabled = isSubmitting || !canSubmit || plantStatus === "sold";
  const showValidationOverlay =
    !isSubmitting && plantStatus !== "sold" && !canSubmit;

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
        <div className="grid grid-cols-2 gap-2">
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
        </div>
      </fieldset>

      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700" htmlFor="fullName">
          Full name
        </label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          className={baseInputClass}
          value={fields.fullName}
          onChange={(event) => handleChange("fullName", event.target.value)}
          onBlur={() => markTouched("fullName")}
          placeholder="Jane Doe"
        />
        {errors.fullName ? <p className="text-xs text-red-600">{errors.fullName}</p> : null}
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          className={baseInputClass}
          value={fields.email}
          onChange={(event) => handleChange("email", event.target.value)}
          onBlur={() => markTouched("email")}
          placeholder="jane.doe@example.com"
        />
        {errors.email ? <p className="text-xs text-red-600">{errors.email}</p> : null}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700" htmlFor="phone">
          Phone number
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          className={baseInputClass}
          value={fields.phone}
          onChange={(event) => {
            const normalized = normalizeIsraeliMobilePhoneInput(event.target.value);
            handleChange("phone", normalized);
          }}
          onBlur={() => markTouched("phone")}
          placeholder="0521234567"
          maxLength={10}
        />
        {errors.phone ? <p className="text-xs text-red-600">{errors.phone}</p> : null}
      </div>

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
    </form>
  );
}
