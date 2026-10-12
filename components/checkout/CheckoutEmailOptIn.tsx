"use client";

import { useId } from "react";

import { useLocale } from "@/components/locale/LocaleProvider";
import { t } from "@/lib/messages";

interface CheckoutEmailOptInProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** Optional "email me my receipt and care instructions" checkbox (default unchecked). */
export function CheckoutEmailOptIn({
  checked,
  onChange,
  disabled,
}: CheckoutEmailOptInProps) {
  const locale = useLocale();
  const inputId = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={inputId}
        name="emailOptIn"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-5 w-5 shrink-0 rounded border-slate-300 accent-emerald-700"
      />
      <label htmlFor={inputId} className="text-body text-slate-700">
        {t(locale, "checkout.emailOptIn.label")}
      </label>
    </div>
  );
}
