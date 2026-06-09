import type { SavedOrder } from "@/lib/orderTypes";
import { isOrderStatus, type OrderStatus } from "@/lib/status";
import { toIsoDateString } from "@/lib/storageUtils";

export interface OrdersFilterState {
  statuses: OrderStatus[];
  location: string | "all" | "__none__";
  plant: string | "all";
  dateFrom?: string;
  dateTo?: string;
}

export function parseStatuses(raw: string | string[] | undefined): OrderStatus[] {
  if (raw == null) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values.filter((value): value is OrderStatus => isOrderStatus(value));
}

export function parseDateParam(raw: string | undefined): string | undefined {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  return raw;
}

export function parseLocation(raw: string | undefined): string | "all" | "__none__" {
  if (raw === "__none__") return "__none__";
  if (raw && raw !== "all") return raw;
  return "all";
}

export function parsePlant(raw: string | undefined): string | "all" {
  if (raw && raw !== "all") return raw;
  return "all";
}

function orderCreatedDate(order: SavedOrder): string | undefined {
  return toIsoDateString(order.createdAt);
}

export function filterOrders(allOrders: SavedOrder[], filters: OrdersFilterState): SavedOrder[] {
  return allOrders.filter((order) => {
    if (filters.statuses.length > 0 && !filters.statuses.includes(order.orderStatus)) return false;

    const productId = order.snapshot?.productId ?? order.plantId;
    if (filters.plant !== "all" && productId !== filters.plant) return false;

    const locationId = order.snapshot?.partnerLocationId ?? order.locationId;
    if (filters.location !== "all") {
      if (filters.location === "__none__" && locationId !== null) return false;
      if (filters.location !== "__none__" && locationId !== filters.location) return false;
    }

    const createdDate = orderCreatedDate(order);
    if (filters.dateFrom && (!createdDate || createdDate < filters.dateFrom)) return false;
    if (filters.dateTo && (!createdDate || createdDate > filters.dateTo)) return false;

    return true;
  });
}

export function ordersQueryUrl(filters: OrdersFilterState): string {
  const params = new URLSearchParams();
  for (const status of filters.statuses) {
    params.append("status", status);
  }
  if (filters.location !== "all") {
    params.set("location", filters.location === "__none__" ? "__none__" : filters.location);
  }
  if (filters.plant !== "all") params.set("plant", filters.plant);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  const qs = params.toString();
  return qs ? `/admin/orders?${qs}` : "/admin/orders";
}
