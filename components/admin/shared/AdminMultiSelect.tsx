"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  adminCheckboxClassName,
  adminOptionRowClassName,
  adminSelectTriggerClassName,
} from "@/components/admin/shared/adminSelectionStyles";

export type AdminSelectOption = {
  value: string;
  label: string;
  description?: string;
};

type AdminMultiSelectProps = {
  options: AdminSelectOption[];
  values: string[];
  onChange: (values: string[]) => void;
  /** Shown on the closed trigger. Defaults to joined labels / "All" when empty if emptyLabel set. */
  summary?: string;
  /** Label when nothing is selected (e.g. "All" or "Select…"). */
  emptyLabel?: string;
  disabled?: boolean;
  "aria-label"?: string;
};

function defaultSummary(
  options: AdminSelectOption[],
  values: string[],
  emptyLabel: string,
): string {
  if (values.length === 0) return emptyLabel;
  const labelByValue = new Map(options.map((o) => [o.value, o.label]));
  return values.map((v) => labelByValue.get(v) ?? v).join(", ");
}

/**
 * Dropdown multi-select with square checkboxes.
 * Empty `values` means none selected (caller interprets as "all" or "required" as needed).
 */
export function AdminMultiSelect({
  options,
  values,
  onChange,
  summary,
  emptyLabel = "Select…",
  disabled = false,
  "aria-label": ariaLabel,
}: AdminMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = new Set(values);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(value: string) {
    const next = selected.has(value)
      ? values.filter((v) => v !== value)
      : [...values, value];
    onChange(next);
  }

  const triggerText = summary ?? defaultSummary(options, values, emptyLabel);

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <button
        type="button"
        className={`${adminSelectTriggerClassName} cursor-pointer text-left disabled:opacity-60`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        <span className="block truncate pr-1">{triggerText}</span>
      </button>

      {open ? (
        <div
          id={listId}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
          role="listbox"
          aria-multiselectable
          aria-label={ariaLabel}
        >
          {options.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">No options</p>
          ) : (
            options.map((opt) => {
              const checked = selected.has(opt.value);
              return (
                <label
                  key={opt.value}
                  className={adminOptionRowClassName}
                  role="option"
                  aria-selected={checked}
                >
                  <input
                    type="checkbox"
                    className={adminCheckboxClassName}
                    checked={checked}
                    onChange={() => toggle(opt.value)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{opt.label}</span>
                    {opt.description ? (
                      <span className="block truncate text-xs text-slate-500">
                        {opt.description}
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
