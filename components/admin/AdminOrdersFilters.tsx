"use client";

import { useRouter } from "next/navigation";

import { AdminMultiSelect } from "@/components/admin/shared/AdminMultiSelect";
import { adminSelectTriggerClassName } from "@/components/admin/shared/adminSelectionStyles";
import type { OrdersFilterState } from "@/lib/adminOrdersFilterUtils";
import { ordersQueryUrl } from "@/lib/adminOrdersFilterUtils";
import type { OrderStatus } from "@/lib/status";
import { ORDER_STATUS_LABELS } from "@/lib/status";

const ORDER_STATUSES: OrderStatus[] = [
  "pending_payment",
  "sold",
  "picked_up",
  "delivered",
  "cancelled",
];

const STATUS_OPTIONS = ORDER_STATUSES.map((status) => ({
  value: status,
  label: ORDER_STATUS_LABELS[status],
}));

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
        <AdminMultiSelect
          aria-label="Status"
          options={STATUS_OPTIONS}
          values={currentStatuses}
          summary={statusSummary(currentStatuses)}
          emptyLabel="All"
          onChange={(values) =>
            navigate({
              ...filters,
              statuses: values.filter((v): v is OrderStatus =>
                ORDER_STATUSES.includes(v as OrderStatus),
              ),
            })
          }
        />
      </label>

      <label className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Location
        </span>
        <select
          className={adminSelectTriggerClassName}
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
          className={adminSelectTriggerClassName}
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
          className={adminSelectTriggerClassName}
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
          className={adminSelectTriggerClassName}
          value={currentDateTo ?? ""}
          onChange={(e) => navigate({ ...filters, dateTo: e.target.value || undefined })}
        />
      </label>
    </section>
  );
}
