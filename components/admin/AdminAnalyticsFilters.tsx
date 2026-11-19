"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { AdminDateFilter } from "@/components/admin/shared/AdminDateFilter";
import { adminSelectTriggerClassName } from "@/components/admin/shared/adminSelectionStyles";
import { useLocale } from "@/components/locale/LocaleProvider";
import {
  analyticsQueryUrl,
  type AnalyticsFilterState,
  type AnalyticsInventoryFilter,
} from "@/lib/analytics/analyticsQuery";
import type { DateFilterValue } from "@/lib/dateFilter";
import { DATE_FILTER_PRESETS } from "@/lib/dateFilter";
import { INVENTORY_TYPES } from "@/lib/inventoryType";
import { t } from "@/lib/messages";

const INVENTORY_LABEL_KEY = {
  plants: "admin.inventoryTypes.plants",
  flowers: "admin.inventoryTypes.flowers",
} as const;

const DATE_PRESET_LABEL_KEY = {
  today: "admin.dateFilter.today",
  last_week: "admin.dateFilter.lastWeek",
  last_month: "admin.dateFilter.lastMonth",
  all_time: "admin.dateFilter.allTime",
} as const;

export function AdminAnalyticsFilters({
  inventoryType,
  dateFilter,
  partnerId,
  area,
  partners,
}: AnalyticsFilterState & { partners: { id: string; name: string }[] }) {
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimisticInventoryType, setOptimisticInventoryType] =
    useState<AnalyticsInventoryFilter>(inventoryType);

  useEffect(() => {
    setOptimisticInventoryType(inventoryType);
  }, [inventoryType]);

  function navigate(next: AnalyticsFilterState) {
    if (isPending) return;
    const href = analyticsQueryUrl(next);
    startTransition(() => {
      router.push(href);
    });
  }

  return (
    <div
      className="mb-6 flex flex-row flex-wrap items-end gap-2 sm:gap-3"
      aria-busy={isPending}
    >
      <label className="flex min-w-40 flex-1 flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t(locale, "admin.analytics.inventoryType")}
        </span>
        <select
          className={`${adminSelectTriggerClassName} disabled:cursor-not-allowed disabled:bg-slate-50`}
          value={optimisticInventoryType}
          disabled={isPending}
          aria-label={t(locale, "admin.analytics.inventoryType")}
          onChange={(e) => {
            const value = e.target.value as AnalyticsInventoryFilter;
            setOptimisticInventoryType(value);
            navigate({ inventoryType: value, dateFilter, partnerId, area });
          }}
        >
          <option value="all">{t(locale, "admin.common.all")}</option>
          {INVENTORY_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(locale, INVENTORY_LABEL_KEY[type])}
            </option>
          ))}
        </select>
      </label>

      <label className="flex min-w-40 flex-1 flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t(locale, "admin.analytics.dateRange")}
        </span>
        <AdminDateFilter
          value={dateFilter}
          disabled={isPending}
          aria-label={t(locale, "admin.analytics.dateRange")}
          presets={DATE_FILTER_PRESETS.map((id) => ({
            id,
            label: t(locale, DATE_PRESET_LABEL_KEY[id]),
          }))}
          onChange={(next: DateFilterValue) =>
            navigate({
              inventoryType: optimisticInventoryType,
              dateFilter: next,
              partnerId,
              area,
            })
          }
        />
      </label>

      <label className="flex min-w-40 flex-1 flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t(locale, "admin.analytics.partner")}
        </span>
        <select
          className={`${adminSelectTriggerClassName} disabled:cursor-not-allowed disabled:bg-slate-50`}
          value={partnerId ?? ""}
          disabled={isPending}
          aria-label={t(locale, "admin.analytics.partner")}
          onChange={(e) => {
            navigate({
              inventoryType: optimisticInventoryType,
              dateFilter,
              partnerId: e.target.value || null,
              area,
            });
          }}
        >
          <option value="">{t(locale, "admin.analytics.scopeUrban")}</option>
          {partners.map((partner) => (
            <option key={partner.id} value={partner.id}>
              {partner.name}
            </option>
          ))}
        </select>
      </label>
      {isPending ? (
        <p className="w-full text-xs text-slate-500" role="status">
          {t(locale, "admin.common.loading")}
        </p>
      ) : null}
    </div>
  );
}
