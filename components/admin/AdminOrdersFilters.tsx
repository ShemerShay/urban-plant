"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { OrdersFilterState } from "@/lib/adminOrdersFilterUtils";
import { ordersQueryUrl } from "@/lib/adminOrdersFilterUtils";
import type { OrderStatus } from "@/lib/status";
import { ORDER_STATUS_LABELS } from "@/lib/status";

const ORDER_STATUSES: OrderStatus[] = ["sold", "picked_up", "delivered", "cancelled"];

const selectClass =
  "h-11 w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-white pl-3 pr-9 text-sm font-medium text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60";

export interface FilterOption {
  value: string;
  label: string;
}

interface AdminOrdersFiltersProps {
  currentStatuses: OrderStatus[];
  currentLocation: string | "all" | "__none__";
  currentPlant: string | "all";
  currentDateFrom?: string;
  currentDateTo?: string;
  locationOptions: FilterOption[];
  plantOptions: FilterOption[];
}

function filterState(props: AdminOrdersFiltersProps): OrdersFilterState {
  return {
    statuses: props.currentStatuses,
    location: props.currentLocation,
    plant: props.currentPlant,
    dateFrom: props.currentDateFrom,
    dateTo: props.currentDateTo,
  };
}

function statusSummary(statuses: OrderStatus[]): string {
  if (statuses.length === 0) return "All";
  return statuses.map((status) => ORDER_STATUS_LABELS[status]).join(", ");
}

function AdminOrdersStatusMultiSelect({
  currentStatuses,
  onChange,
}: {
  currentStatuses: OrderStatus[];
  onChange: (statuses: OrderStatus[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  function toggleStatus(status: OrderStatus) {
    const next = currentStatuses.includes(status)
      ? currentStatuses.filter((value) => value !== status)
      : [...currentStatuses, status];
    onChange(next);
  }

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <button
        type="button"
        className={`${selectClass} cursor-pointer text-left`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="block truncate pr-1">{statusSummary(currentStatuses)}</span>
      </button>

      {open ? (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
          role="listbox"
          aria-multiselectable
        >
          {ORDER_STATUSES.map((status) => {
            const checked = currentStatuses.includes(status);
            return (
              <label
                key={status}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-slate-900 transition hover:bg-slate-50"
                role="option"
                aria-selected={checked}
              >
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600/30"
                  checked={checked}
                  onChange={() => toggleStatus(status)}
                />
                {ORDER_STATUS_LABELS[status]}
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function AdminOrdersFilters({
  currentStatuses,
  currentLocation,
  currentPlant,
  currentDateFrom,
  currentDateTo,
  locationOptions,
  plantOptions,
}: AdminOrdersFiltersProps) {
  const router = useRouter();
  const filters = filterState({
    currentStatuses,
    currentLocation,
    currentPlant,
    currentDateFrom,
    currentDateTo,
    locationOptions,
    plantOptions,
  });

  function navigate(next: OrdersFilterState) {
    router.push(ordersQueryUrl(next));
  }

  return (
    <section
      aria-label="Filter orders"
      className="mb-6 flex flex-nowrap items-end gap-2 sm:gap-3"
    >
      <label className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Status
        </span>
        <AdminOrdersStatusMultiSelect
          currentStatuses={currentStatuses}
          onChange={(statuses) => navigate({ ...filters, statuses })}
        />
      </label>

      <label className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Location
        </span>
        <select
          className={selectClass}
          value={currentLocation}
          onChange={(e) => {
            const value = e.target.value as string | "all" | "__none__";
            navigate({ ...filters, location: value });
          }}
        >
          <option value="all" className="text-slate-900">
            All
          </option>
          {locationOptions.map((opt) => (
            <option key={opt.value} value={opt.value} className="text-slate-900">
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Plant
        </span>
        <select
          className={selectClass}
          value={currentPlant}
          onChange={(e) => {
            navigate({ ...filters, plant: e.target.value });
          }}
        >
          <option value="all" className="text-slate-900">
            All
          </option>
          {plantOptions.map((opt) => (
            <option key={opt.value} value={opt.value} className="text-slate-900">
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          From
        </span>
        <input
          type="date"
          className={selectClass}
          value={currentDateFrom ?? ""}
          onChange={(e) =>
            navigate({ ...filters, dateFrom: e.target.value || undefined })
          }
        />
      </label>

      <label className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          To
        </span>
        <input
          type="date"
          className={selectClass}
          value={currentDateTo ?? ""}
          onChange={(e) => navigate({ ...filters, dateTo: e.target.value || undefined })}
        />
      </label>
    </section>
  );
}
