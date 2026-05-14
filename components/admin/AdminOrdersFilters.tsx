"use client";

import { useRouter } from "next/navigation";

import type { OrderStatus } from "@/lib/status";
import { ORDER_STATUS_LABELS } from "@/lib/status";

const ORDER_STATUSES: OrderStatus[] = [
  "pending_payment",
  "available",
  "sold",
  "picked_up",
  "delivered",
];

const selectClass =
  "h-11 w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-white pl-3 pr-9 text-sm font-medium text-emerald-950 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60";

export interface FilterOption {
  value: string;
  label: string;
}

interface AdminOrdersFiltersProps {
  currentStatus: OrderStatus | "all";
  currentLocation: string | "all" | "__none__";
  currentPlant: string | "all";
  locationOptions: FilterOption[];
  plantOptions: FilterOption[];
}

function ordersQueryUrl(
  status: OrderStatus | "all",
  location: string | "all" | "__none__",
  plant: string | "all",
): string {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (location !== "all") {
    params.set("location", location === "__none__" ? "__none__" : location);
  }
  if (plant !== "all") params.set("plant", plant);
  const qs = params.toString();
  return qs ? `/admin/orders?${qs}` : "/admin/orders";
}

export function AdminOrdersFilters({
  currentStatus,
  currentLocation,
  currentPlant,
  locationOptions,
  plantOptions,
}: AdminOrdersFiltersProps) {
  const router = useRouter();

  return (
    <section
      aria-label="Filter orders"
      className="mb-6 flex flex-nowrap items-end gap-2 sm:gap-3"
    >
      <label className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Status
        </span>
        <select
          className={selectClass}
          value={currentStatus}
          onChange={(e) => {
            const v = e.target.value as OrderStatus | "all";
            router.push(ordersQueryUrl(v, currentLocation, currentPlant));
          }}
        >
          <option value="all">All</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Location
        </span>
        <select
          className={selectClass}
          value={currentLocation}
          onChange={(e) => {
            const v = e.target.value as string | "all" | "__none__";
            router.push(ordersQueryUrl(currentStatus, v, currentPlant));
          }}
        >
          <option value="all">All</option>
          {locationOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
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
            const v = e.target.value;
            router.push(ordersQueryUrl(currentStatus, currentLocation, v));
          }}
        >
          <option value="all">All</option>
          {plantOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
