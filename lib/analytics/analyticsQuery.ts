import type { DateFilterValue } from "@/lib/dateFilter";
import {
  DEFAULT_DATE_FILTER_PRESET,
  defaultDateFilterValue,
  isDateFilterPresetId,
  normalizeDateFilterValue,
  parseCalendarYmd,
} from "@/lib/dateFilter";
import { DEFAULT_INVENTORY_TYPE, parseInventoryType, type InventoryType } from "@/lib/inventoryType";
import { routes } from "@/lib/routes";

export type AnalyticsInventoryFilter = InventoryType | "all";

export const DEFAULT_ANALYTICS_INVENTORY_FILTER: AnalyticsInventoryFilter =
  DEFAULT_INVENTORY_TYPE;

export type AnalyticsFilterState = {
  inventoryType: AnalyticsInventoryFilter;
  dateFilter: DateFilterValue;
};

export function parseAnalyticsInventoryType(
  raw: string | undefined | null,
): AnalyticsInventoryFilter {
  const v = (raw ?? "").trim();
  if (v === "all") return "all";
  return parseInventoryType(v) ?? DEFAULT_ANALYTICS_INVENTORY_FILTER;
}

export function parseAnalyticsDateFilter(
  input: {
    date?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
  },
  now: Date = new Date(),
): DateFilterValue {
  const from = parseCalendarYmd(input.from);
  const to = parseCalendarYmd(input.to);
  if (from && to) {
    return normalizeDateFilterValue({ mode: "range", from, to }, now);
  }
  if (isDateFilterPresetId(input.date)) {
    return { mode: "preset", presetId: input.date };
  }
  return defaultDateFilterValue();
}

export function parseAnalyticsFilterState(
  input: {
    inventoryType?: string | undefined;
    date?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
  },
  now: Date = new Date(),
): AnalyticsFilterState {
  return {
    inventoryType: parseAnalyticsInventoryType(input.inventoryType),
    dateFilter: parseAnalyticsDateFilter(input, now),
  };
}

export function analyticsQueryUrl(state: AnalyticsFilterState): string {
  const params = new URLSearchParams();
  if (state.inventoryType !== DEFAULT_ANALYTICS_INVENTORY_FILTER) {
    params.set("inventoryType", state.inventoryType);
  }
  if (state.dateFilter.mode === "range") {
    params.set("from", state.dateFilter.from);
    params.set("to", state.dateFilter.to);
  } else if (state.dateFilter.presetId !== DEFAULT_DATE_FILTER_PRESET) {
    params.set("date", state.dateFilter.presetId);
  }
  return routes.admin.analyticsWithQuery(params.toString());
}
