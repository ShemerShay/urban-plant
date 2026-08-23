"use client";

import type { CheckoutFieldKey, CheckoutFormValues } from "@/lib/checkoutValidation";
import { normalizeIsraeliMobilePhoneInput } from "@/lib/formValidation";
import { useLocale } from "@/components/locale/LocaleProvider";
import { t } from "@/lib/messages";

const baseInputClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60";

const invalidInputClass = "border-red-400 focus:border-red-500 focus:ring-red-200/60";

type CustomerFieldKey = Extract<CheckoutFieldKey, "fullName" | "email" | "phone">;

export type CheckoutCustomerFieldValues = Pick<
  CheckoutFormValues,
  "fullName" | "email" | "phone"
>;

export type CheckoutCustomerFieldErrors = Partial<
  Record<CustomerFieldKey, string>
>;

interface CheckoutCustomerFieldsProps {
  values: CheckoutCustomerFieldValues;
  errors: CheckoutCustomerFieldErrors;
  onChange: (field: CustomerFieldKey, value: string) => void;
  onFieldBlur: (field: CheckoutFieldKey) => void;
}

export function CheckoutCustomerFields({
  values,
  errors,
  onChange,
  onFieldBlur,
}: CheckoutCustomerFieldsProps) {
  const locale = useLocale();
  return (
    <>
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700" htmlFor="fullName">
          {t(locale, "checkout.field.fullName")}
          <span aria-hidden="true" className="text-red-700">
            {" "}
            *
          </span>
        </label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          autoCapitalize="words"
          aria-required="true"
          aria-invalid={errors.fullName ? true : undefined}
          aria-describedby={errors.fullName ? "fullName-error" : undefined}
          className={`${baseInputClass} ${errors.fullName ? invalidInputClass : ""}`}
          value={values.fullName}
          onChange={(event) => onChange("fullName", event.target.value)}
          onBlur={() => onFieldBlur("fullName")}
          placeholder={t(locale, "checkout.placeholder.fullName")}
        />
        {errors.fullName ? (
          <p id="fullName-error" className="text-xs text-red-700">
            {errors.fullName}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700" htmlFor="email">
          {t(locale, "checkout.field.email")}
          <span aria-hidden="true" className="text-red-700">
            {" "}
            *
          </span>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          aria-required="true"
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? "email-error" : undefined}
          className={`${baseInputClass} ${errors.email ? invalidInputClass : ""}`}
          value={values.email}
          onChange={(event) => onChange("email", event.target.value)}
          onBlur={() => onFieldBlur("email")}
          placeholder={t(locale, "checkout.placeholder.email")}
        />
        {errors.email ? (
          <p id="email-error" className="text-xs text-red-700">
            {errors.email}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700" htmlFor="phone">
          {t(locale, "checkout.field.phone")}
          <span aria-hidden="true" className="text-red-700">
            {" "}
            *
          </span>
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          aria-required="true"
          aria-invalid={errors.phone ? true : undefined}
          aria-describedby={errors.phone ? "phone-error" : undefined}
          className={`${baseInputClass} ${errors.phone ? invalidInputClass : ""}`}
          value={values.phone}
          onChange={(event) => {
            const normalized = normalizeIsraeliMobilePhoneInput(event.target.value);
            onChange("phone", normalized);
          }}
          onBlur={() => onFieldBlur("phone")}
          placeholder="0521234567"
          maxLength={10}
        />
        {errors.phone ? (
          <p id="phone-error" className="text-xs text-red-700">
            {errors.phone}
          </p>
        ) : null}
      </div>
    </>
  );
}
