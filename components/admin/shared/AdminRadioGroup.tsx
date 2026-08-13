"use client";

import { adminRadioClassName } from "@/components/admin/shared/adminSelectionStyles";
import type { AdminSelectOption } from "@/components/admin/shared/AdminMultiSelect";

type AdminRadioGroupProps = {
  name: string;
  options: AdminSelectOption[];
  value: string;
  onChange: (value: string) => void;
  legend?: string;
  disabled?: boolean;
};

/**
 * Single-select option list with circular radio controls.
 */
export function AdminRadioGroup({
  name,
  options,
  value,
  onChange,
  legend,
  disabled = false,
}: AdminRadioGroupProps) {
  return (
    <fieldset className="space-y-1" disabled={disabled}>
      {legend ? (
        <legend className="text-sm font-medium text-slate-700">{legend}</legend>
      ) : null}
      <div className="space-y-1">
        {options.map((opt) => (
          <label
            key={opt.value}
            className="flex cursor-pointer items-center gap-2 rounded-lg py-1.5 text-sm text-slate-900 transition hover:bg-slate-50/80"
          >
            <input
              type="radio"
              name={name}
              className={adminRadioClassName}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
            />
            <span className="min-w-0">
              <span className="block">{opt.label}</span>
              {opt.description ? (
                <span className="block text-xs text-slate-500">{opt.description}</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
