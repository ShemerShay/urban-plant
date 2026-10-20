"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { AdminMultiSelect } from "@/components/admin/shared/AdminMultiSelect";
import { adminSelectTriggerClassName } from "@/components/admin/shared/adminSelectionStyles";
import { useLocale } from "@/components/locale/LocaleProvider";
import type { OrdersChannelFilter, OrdersFilterState } from "@/lib/adminOrdersFilterUtils";
import { ordersQueryUrl } from "@/lib/adminOrdersFilterUtils";
import { orderChannelLabel, orderStatusLabel } from "@/lib/displayLabels";
import { t } from "@/lib/messages";
import type { OrderStatus } from "@/lib/status";

const ORDER_STATUSES: OrderStatus[] = [
  "pending_payment",
  "sold",
  "picked_up",
  "delivered",
  "cancelled",
];

const CHANNELS: OrdersChannelFilter[] = ["all", "catalog", "partner"];

export interface FilterOption {
  value: string;
  label: string;
}

interface AdminOrdersFiltersProps {
  currentStatuses: OrderStatus[];
  currentChannel: OrdersChannelFilter;
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
    channel: props.currentChannel,
    location: props.currentLocation,
    plant: props.currentPlant,
    dateFrom: props.currentDateFrom,
    dateTo: props.currentDateTo,
  };
}

export function AdminOrdersFilters({
  currentStatuses,
  currentChannel,
  currentLocation,
  currentPlant,
  currentDateFrom,
  currentDateTo,
  locationOptions,
  plantOptions,
}: AdminOrdersFiltersProps) {
  const locale = useLocale();
  const router = useRouter();
  const filters = filterState({
    currentStatuses,
    currentChannel,
    currentLocation,
    currentPlant,
    currentDateFrom,
    currentDateTo,
    locationOptions,
    plantOptions,
  });

  const statusOptions = useMemo(
    () =>
      ORDER_STATUSES.map((status) => ({
        value: status,
        label: orderStatusLabel(locale, status),
      })),
    [locale],
  );

  function statusSummary(statuses: OrderStatus[]): string {
    if (statuses.length === 0) return t(locale, "admin.common.all");
    return statuses.map((status) => orderStatusLabel(locale, status)).join(", ");
  }

  function navigate(next: OrdersFilterState) {
    router.push(ordersQueryUrl(next));
  }

  return (
    <section
      aria-label={t(locale, "admin.orders.filterAria")}
      className="mb-6 flex flex-nowrap items-end gap-2 sm:gap-3"
    >
      <label className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t(locale, "admin.orders.status")}
        </span>
        <AdminMultiSelect
          aria-label={t(locale, "admin.orders.status")}
          options={statusOptions}
          values={currentStatuses}
          summary={statusSummary(currentStatuses)}
          emptyLabel={t(locale, "admin.common.all")}
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
          {t(locale, "admin.orders.channel")}
        </span>
        <select
          className={adminSelectTriggerClassName}
          value={currentChannel}
          onChange={(e) => {
            const value = e.target.value as OrdersChannelFilter;
            navigate({ ...filters, channel: value });
          }}
        >
          {CHANNELS.map((channel) => (
            <option key={channel} value={channel} className="text-slate-900">
              {channel === "all"
                ? t(locale, "admin.common.all")
                : orderChannelLabel(locale, channel)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t(locale, "admin.common.location")}
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
            {t(locale, "admin.common.all")}
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
          {t(locale, "admin.common.plant")}
        </span>
        <select
          className={adminSelectTriggerClassName}
          value={currentPlant}
          onChange={(e) => {
            navigate({ ...filters, plant: e.target.value });
          }}
        >
          <option value="all" className="text-slate-900">
            {t(locale, "admin.common.all")}
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
          {t(locale, "admin.orders.from")}
        </span>
        <input
          type="date"
          className={adminSelectTriggerClassName}
          value={currentDateFrom ?? ""}
          onChange={(e) => navigate({ ...filters, dateFrom: e.target.value || undefined })}
        />
      </label>

      <label className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t(locale, "admin.orders.to")}
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
