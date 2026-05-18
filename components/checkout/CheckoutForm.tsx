"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { isValidEmail, isValidPhone } from "@/lib/formValidation";
import type { PlantCatalogStatus } from "@/lib/types";

type FormFields = {
  fullName: string;
  email: string;
  phone: string;
  address: string;
  apartmentOrNotes: string;
};

type FulfillmentMethod = "delivery" | "pickup";

type FieldErrors = Partial<Record<keyof FormFields, string>>;

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
    phone: "",
    address: "",
    apartmentOrNotes: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [prepMessage, setPrepMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  void _priceDisplay;

  function handleChange(field: keyof FormFields, value: string) {
    setFields((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setSubmitError(null);
    setPrepMessage(null);
  }

  function handleFulfillmentChange(next: FulfillmentMethod) {
    setFulfillmentMethod(next);
    setErrors((prev) => ({
      ...prev,
      address: next === "pickup" ? undefined : prev.address,
    }));
    setSubmitError(null);
    setPrepMessage(null);
  }

  function validate() {
    const nextErrors: FieldErrors = {};

    if (!fields.fullName.trim()) nextErrors.fullName = "Full name is required.";

    const emailTrim = fields.email.trim();
    if (!emailTrim) nextErrors.email = "Email is required.";
    else if (!isValidEmail(emailTrim)) {
      nextErrors.email = "Enter a valid email address.";
    }

    const phoneTrim = fields.phone.trim();
    if (!phoneTrim) nextErrors.phone = "Phone number is required.";
    else if (!isValidPhone(phoneTrim)) {
      nextErrors.phone = "Enter a valid phone number.";
    }

    if (fulfillmentMethod === "delivery" && !fields.address.trim()) {
      nextErrors.address = "Address is required.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (plantStatus === "sold" || !canSubmit) return;
    if (!validate()) return;

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
          address:
            fulfillmentMethod === "delivery" ? fields.address.trim() : "",
          apartmentOrNotes:
            fulfillmentMethod === "delivery"
              ? fields.apartmentOrNotes.trim()
              : "",
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

  const canSubmit =
    fields.fullName.trim().length > 0 &&
    isValidEmail(fields.email) &&
    isValidPhone(fields.phone) &&
    (fulfillmentMethod === "pickup" || fields.address.trim().length > 0);
  const isSubmitDisabled = isSubmitting || !canSubmit || plantStatus === "sold";

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
          autoComplete="tel"
          className={baseInputClass}
          value={fields.phone}
          onChange={(event) => handleChange("phone", event.target.value)}
          placeholder="+972 50 000 0000"
        />
        {errors.phone ? <p className="text-xs text-red-600">{errors.phone}</p> : null}
      </div>

      {fulfillmentMethod === "delivery" ? (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="address">
              Address
            </label>
            <input
              id="address"
              name="address"
              type="text"
              autoComplete="street-address"
              className={baseInputClass}
              value={fields.address}
              onChange={(event) => handleChange("address", event.target.value)}
              placeholder="Street and number"
            />
            {errors.address ? <p className="text-xs text-red-600">{errors.address}</p> : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="apartmentOrNotes">
              Apartment / floor / notes (optional)
            </label>
            <textarea
              id="apartmentOrNotes"
              name="apartmentOrNotes"
              className={baseInputClass}
              value={fields.apartmentOrNotes}
              onChange={(event) => handleChange("apartmentOrNotes", event.target.value)}
              rows={3}
              placeholder="Door code, floor, delivery details..."
            />
          </div>
        </>
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

      <button
        type="submit"
        disabled={isSubmitDisabled}
        className="w-full rounded-2xl bg-emerald-700 px-5 py-4 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-500 disabled:hover:bg-neutral-300"
      >
        {isSubmitting ? "Processing…" : "Complete Order"}
      </button>
    </form>
  );
}
