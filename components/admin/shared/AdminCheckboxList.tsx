"use client";

import {
  adminCheckboxClassName,
} from "@/components/admin/shared/adminSelectionStyles";
import type { AdminSelectOption } from "@/components/admin/shared/AdminMultiSelect";
import { useLocale } from "@/components/locale/LocaleProvider";
import { t } from "@/lib/messages";

type AdminCheckboxListProps = {
  options: AdminSelectOption[];
  values: string[];
  onChange: (values: string[]) => void;
  emptyMessage?: string;
  className?: string;
  "aria-label"?: string;
};

/**
 * Always-visible multi-select list with square checkboxes.
 */
export function AdminCheckboxList({
  options,
  values,
  onChange,
  emptyMessage: emptyMessageProp,
  className = "max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-100 p-2",
  "aria-label": ariaLabel,
}: AdminCheckboxListProps) {
  const locale = useLocale();
  const emptyMessage = emptyMessageProp ?? t(locale, "admin.shared.noOptions");
  const selected = new Set(values);

  function toggle(value: string) {
    const next = selected.has(value)
      ? values.filter((v) => v !== value)
      : [...values, value];
    onChange(next);
  }

  if (options.length === 0) {
    return <p className="text-sm text-slate-500">{emptyMessage}</p>;
  }

  return (
    <ul className={className} role="listbox" aria-multiselectable aria-label={ariaLabel}>
      {options.map((opt) => {
        const checked = selected.has(opt.value);
        return (
          <li key={opt.value}>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
              <input
                type="checkbox"
                className={`${adminCheckboxClassName} mt-1`}
                checked={checked}
                onChange={() => toggle(opt.value)}
              />
              <span className="min-w-0">
                <span className="block font-medium text-emerald-950">{opt.label}</span>
                {opt.description ? (
                  <span className="block text-xs text-slate-500">{opt.description}</span>
                ) : null}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
