"use client";

/**
 * Local JSON order management is only for prototype/testing and should be replaced
 * with a real database before production.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

const inputClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60";

export function AdminNewOrderForm() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [apartmentOrNotes, setApartmentOrNotes] = useState("");
  const [plantName, setPlantName] = useState("");
  const [price, setPrice] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!fullName.trim()) next.fullName = "Full name is required.";
    if (!phone.trim()) next.phone = "Phone is required.";
    if (!address.trim()) next.address = "Address is required.";
    if (!plantName.trim()) next.plantName = "Plant name is required.";
    if (!price.trim()) next.price = "Price is required.";
    else if (Number(price) < 0 || Number.isNaN(Number(price))) {
      next.price = "Enter a valid price.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phone.trim(),
          address: address.trim(),
          apartmentOrNotes: apartmentOrNotes.trim(),
          plantName: plantName.trim(),
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

  return (
    <form id="admin-new-order-form" onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="admin-fullName" className="text-sm font-medium text-slate-700">
          Full name
        </label>
        <input
          id="admin-fullName"
          name="fullName"
          type="text"
          className={inputClass}
          value={fullName}
          onChange={(ev) => setFullName(ev.target.value)}
        />
        {errors.fullName ? <p className="text-xs text-red-600">{errors.fullName}</p> : null}
      </div>

      <div className="space-y-2">
        <label htmlFor="admin-phone" className="text-sm font-medium text-slate-700">
          Phone
        </label>
        <input
          id="admin-phone"
          name="phone"
          type="tel"
          className={inputClass}
          value={phone}
          onChange={(ev) => setPhone(ev.target.value)}
        />
        {errors.phone ? <p className="text-xs text-red-600">{errors.phone}</p> : null}
      </div>

      <div className="space-y-2">
        <label htmlFor="admin-address" className="text-sm font-medium text-slate-700">
          Address
        </label>
        <input
          id="admin-address"
          name="address"
          type="text"
          className={inputClass}
          value={address}
          onChange={(ev) => setAddress(ev.target.value)}
        />
        {errors.address ? <p className="text-xs text-red-600">{errors.address}</p> : null}
      </div>

      <div className="space-y-2">
        <label
          htmlFor="admin-apartmentOrNotes"
          className="text-sm font-medium text-slate-700"
        >
          Apartment / notes (optional)
        </label>
        <textarea
          id="admin-apartmentOrNotes"
          name="apartmentOrNotes"
          rows={3}
          className={inputClass}
          value={apartmentOrNotes}
          onChange={(ev) => setApartmentOrNotes(ev.target.value)}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="admin-plantName" className="text-sm font-medium text-slate-700">
          Plant name
        </label>
        <input
          id="admin-plantName"
          name="plantName"
          type="text"
          className={inputClass}
          value={plantName}
          onChange={(ev) => setPlantName(ev.target.value)}
        />
        {errors.plantName ? <p className="text-xs text-red-600">{errors.plantName}</p> : null}
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
          className={inputClass}
          value={price}
          onChange={(ev) => setPrice(ev.target.value)}
        />
        {errors.price ? <p className="text-xs text-red-600">{errors.price}</p> : null}
      </div>

      {submitError ? <p className="text-sm text-red-600">{submitError}</p> : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-2xl bg-emerald-700 px-5 py-4 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-60"
      >
        {isSubmitting ? "Saving…" : "Save order"}
      </button>
    </form>
  );
}
