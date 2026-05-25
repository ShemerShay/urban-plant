import type { CheckoutFieldKey, CheckoutFormValues } from "@/lib/checkoutValidation";
import { normalizeIsraeliMobilePhoneInput } from "@/lib/formValidation";

const baseInputClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60";

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
  return (
    <>
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
          value={values.fullName}
          onChange={(event) => onChange("fullName", event.target.value)}
          onBlur={() => onFieldBlur("fullName")}
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
          value={values.email}
          onChange={(event) => onChange("email", event.target.value)}
          onBlur={() => onFieldBlur("email")}
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
          value={values.phone}
          onChange={(event) => {
            const normalized = normalizeIsraeliMobilePhoneInput(event.target.value);
            onChange("phone", normalized);
          }}
          onBlur={() => onFieldBlur("phone")}
          placeholder="0521234567"
          maxLength={10}
        />
        {errors.phone ? <p className="text-xs text-red-600">{errors.phone}</p> : null}
      </div>
    </>
  );
}
