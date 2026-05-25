"use client";

/**
 * Local JSON order management is only for prototype/testing and should be replaced
 * with a real database before production.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CheckoutCustomerFields } from "@/components/checkout/CheckoutCustomerFields";
import { DeliveryAddressFields } from "@/components/checkout/DeliveryAddressFields";
import type { DeliveryAddressFieldValues } from "@/components/checkout/DeliveryAddressFields";
import { formatPrice, mockPlants } from "@/lib/mockPlants";
import {
  canSubmitAdminNewOrder,
  canSubmitCheckout,
  getAdminNewOrderFieldErrors,
  getCheckoutFieldErrors,
  getVisibleAdminNewOrderFieldErrors,
  getVisibleCheckoutFieldErrors,
  type AdminNewOrderFieldKey,
  type CheckoutFieldKey,
  type CheckoutFormValues,
} from "@/lib/checkoutValidation";

const baseInputClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60";

type CustomerFields = Pick<CheckoutFormValues, "fullName" | "email" | "phone"> &
  DeliveryAddressFieldValues;

export function AdminNewOrderForm() {
  const router = useRouter();
  const [fields, setFields] = useState<CustomerFields>({
    fullName: "",
    email: "",
    phone: "05",
    deliveryStreet: "",
    deliveryHouseNumber: "",
    apartmentOrNotes: "",
  });
  const [plantId, setPlantId] = useState(mockPlants[0]?.id ?? "");
  const [price, setPrice] = useState(
    mockPlants[0] ? String(mockPlants[0].price) : "",
  );
  const [touched, setTouched] = useState<Partial<Record<CheckoutFieldKey, boolean>>>({});
  const [adminTouched, setAdminTouched] = useState<
    Partial<Record<AdminNewOrderFieldKey, boolean>>
  >({});
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fulfillmentMethod = "delivery" as const;

  function handlePlantChange(nextPlantId: string) {
    setPlantId(nextPlantId);
    const plant = mockPlants.find((item) => item.id === nextPlantId);
    if (plant) setPrice(String(plant.price));
    setAdminTouched((prev) => ({ ...prev, plantId: true }));
  }

  function markTouched(field: CheckoutFieldKey) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function markAdminTouched(field: AdminNewOrderFieldKey) {
    setAdminTouched((prev) => ({ ...prev, [field]: true }));
  }

  function handleChange(field: keyof CustomerFields, value: string) {
    setFields((prev) => ({ ...prev, [field]: value }));
    if (field !== "apartmentOrNotes") {
      markTouched(field);
    }
    setSubmitError(null);
  }

  function revealValidationErrors() {
    setShowAllErrors(true);
  }

  const checkoutFieldErrors = getCheckoutFieldErrors(fields, fulfillmentMethod);
  const adminFieldErrors = getAdminNewOrderFieldErrors(plantId, price);
  const checkoutErrors = getVisibleCheckoutFieldErrors(
    checkoutFieldErrors,
    touched,
    showAllErrors,
  );
  const adminErrors = getVisibleAdminNewOrderFieldErrors(
    adminFieldErrors,
    adminTouched,
    showAllErrors,
  );
  const canSubmit =
    canSubmitCheckout(fields, fulfillmentMethod) &&
    canSubmitAdminNewOrder(plantId, price) &&
    !isSubmitting;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) {
      revealValidationErrors();
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fields.fullName.trim(),
          customerEmail: fields.email.trim(),
          phone: fields.phone.trim(),
          deliveryStreet: fields.deliveryStreet.trim(),
          deliveryHouseNumber: fields.deliveryHouseNumber.trim(),
          apartmentOrNotes: fields.apartmentOrNotes.trim(),
          plantId: plantId.trim(),
          price: Number(price),
        }),
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setSubmitError(data.error ?? "Could not create order.");
        return;
      }

      router.push("/admin/orders");
      router.refresh();
    } catch {
      setSubmitError("Network error. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const isSubmitDisabled = isSubmitting || !canSubmit;
  const showValidationOverlay = !isSubmitting && !canSubmit;

  return (
    <form id="admin-new-order-form" onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-xl font-semibold text-emerald-950">Delivery details</h2>

      <CheckoutCustomerFields
        values={{
          fullName: fields.fullName,
          email: fields.email,
          phone: fields.phone,
        }}
        errors={{
          fullName: checkoutErrors.fullName,
          email: checkoutErrors.email,
          phone: checkoutErrors.phone,
        }}
        onChange={handleChange}
        onFieldBlur={markTouched}
      />

      <DeliveryAddressFields
        values={{
          deliveryStreet: fields.deliveryStreet,
          deliveryHouseNumber: fields.deliveryHouseNumber,
          apartmentOrNotes: fields.apartmentOrNotes,
        }}
        errors={{
          deliveryStreet: checkoutErrors.deliveryStreet,
          deliveryHouseNumber: checkoutErrors.deliveryHouseNumber,
        }}
        onChange={handleChange}
        onFieldBlur={markTouched}
      />

      <div className="space-y-2">
        <label htmlFor="admin-plantId" className="text-sm font-medium text-slate-700">
          Plant
        </label>
        <select
          id="admin-plantId"
          name="plantId"
          className={baseInputClass}
          value={plantId}
          onChange={(ev) => handlePlantChange(ev.target.value)}
          onBlur={() => markAdminTouched("plantId")}
        >
          {mockPlants.map((plant) => (
            <option key={plant.id} value={plant.id} className="text-slate-900">
              {plant.name} ({formatPrice(plant.price, plant.currency)})
            </option>
          ))}
        </select>
        {adminErrors.plantId ? (
          <p className="text-xs text-red-600">{adminErrors.plantId}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label htmlFor="admin-price" className="text-sm font-medium text-slate-700">
          Price
        </label>
        <input
          id="admin-price"
          name="price"
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          className={baseInputClass}
          value={price}
          onChange={(ev) => {
            setPrice(ev.target.value);
            markAdminTouched("price");
            setSubmitError(null);
          }}
          onBlur={() => markAdminTouched("price")}
        />
        {adminErrors.price ? (
          <p className="text-xs text-red-600">{adminErrors.price}</p>
        ) : null}
      </div>

      {submitError ? <p className="text-sm text-red-600">{submitError}</p> : null}

      <div className="relative">
        {showValidationOverlay ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Show what is required to save the order"
            className="absolute inset-0 z-10 cursor-not-allowed rounded-2xl"
            onClick={revealValidationErrors}
          />
        ) : null}
        <button
          type="submit"
          disabled={isSubmitDisabled}
          className="w-full rounded-2xl bg-emerald-700 px-5 py-4 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-500 disabled:hover:bg-neutral-300"
        >
          {isSubmitting ? "Saving…" : "Save order"}
        </button>
      </div>
    </form>
  );
}
