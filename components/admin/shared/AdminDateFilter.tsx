"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DayPicker, type DateRange } from "react-day-picker";
import "react-day-picker/style.css";

import { adminSelectTriggerClassName } from "@/components/admin/shared/adminSelectionStyles";
import { useLocale } from "@/components/locale/LocaleProvider";
import {
  BUSINESS_TIME_ZONE,
  calendarYmdInTimeZone,
  normalizeDateFilterValue,
  type DateFilterValue,
  zonedStartOfDay,
} from "@/lib/dateFilter";
import { localeHtmlDir } from "@/lib/locale";

export type DateFilterPreset = {
  id: string;
  label: string;
};

type AdminDateFilterProps = {
  value: DateFilterValue;
  onChange: (value: DateFilterValue) => void;
  presets: DateFilterPreset[];
  "aria-label"?: string;
};

function ymdFromPickerDate(date: Date): string {
  return calendarYmdInTimeZone(date, BUSINESS_TIME_ZONE);
}

function pickerDateFromYmd(ymd: string): Date {
  return zonedStartOfDay(ymd, BUSINESS_TIME_ZONE);
}

function selectedRange(value: DateFilterValue): DateRange | undefined {
  if (value.mode !== "range") return undefined;
  return {
    from: pickerDateFromYmd(value.from),
    to: pickerDateFromYmd(value.to),
  };
}

function summaryText(value: DateFilterValue, presets: DateFilterPreset[]): string {
  if (value.mode === "preset") {
    return presets.find((p) => p.id === value.presetId)?.label ?? value.presetId;
  }
  if (value.from === value.to) return value.from;
  return `${value.from} – ${value.to}`;
}

function isPresetSelected(value: DateFilterValue, presetId: string): boolean {
  return value.mode === "preset" && value.presetId === presetId;
}

/**
 * Reusable admin date filter: trigger, popover, presets, and calendar range.
 * Callers own labels, URL state, and bound resolution.
 */
export function AdminDateFilter({
  value,
  onChange,
  presets,
  "aria-label": ariaLabel,
}: AdminDateFilterProps) {
  const locale = useLocale();
  const dir = localeHtmlDir(locale);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(() => selectedRange(value));
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    setDraft(selectedRange(value));
  }, [value]);

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

  function applyPreset(presetId: string) {
    onChange({ mode: "preset", presetId });
    setOpen(false);
  }

  function applyCalendarRange(next: DateRange | undefined) {
    if (!next?.from || !next.to) {
      setDraft(next);
      return;
    }
    const normalized = normalizeDateFilterValue({
      mode: "range",
      from: ymdFromPickerDate(next.from),
      to: ymdFromPickerDate(next.to),
    });
    if (normalized.mode === "range") {
      setDraft({
        from: pickerDateFromYmd(normalized.from),
        to: pickerDateFromYmd(normalized.to),
      });
    } else {
      setDraft(undefined);
    }
    onChange(normalized);
    setOpen(false);
  }

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <button
        type="button"
        className={`${adminSelectTriggerClassName} cursor-pointer text-left`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="block truncate pr-1">{summaryText(value, presets)}</span>
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={ariaLabel}
          className="absolute z-50 mt-1 w-max min-w-full max-w-[min(100vw-2rem,40rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-lg end-0"
        >
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex shrink-0 flex-col gap-1 sm:w-36">
              {presets.map((preset) => {
                const active = isPresetSelected(value, preset.id);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={
                      active
                        ? "rounded-lg bg-emerald-800 px-3 py-2 text-start text-sm font-medium text-white"
                        : "rounded-lg px-3 py-2 text-start text-sm font-medium text-slate-700 hover:bg-slate-50"
                    }
                    onClick={() => applyPreset(preset.id)}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <div dir={dir}>
              <DayPicker
                mode="range"
                selected={draft}
                onSelect={applyCalendarRange}
                timeZone={BUSINESS_TIME_ZONE}
                disabled={{
                  after: pickerDateFromYmd(
                    calendarYmdInTimeZone(new Date(), BUSINESS_TIME_ZONE),
                  ),
                }}
                weekStartsOn={0}
                numberOfMonths={1}
                className="rdp-root text-sm"
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
