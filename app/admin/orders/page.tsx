/**
 * Local JSON order management is only for prototype/testing and should be replaced
 * with a real database-backed admin before production.
 */

import { AdminOrderCard } from "@/components/admin/AdminOrderCard";
import { AdminOrdersHeaderMenu } from "@/components/admin/AdminOrdersHeaderMenu";
import type { FilterOption } from "@/components/admin/AdminOrdersFilters";
import { AdminOrdersFilters } from "@/components/admin/AdminOrdersFilters";
import { readOrders } from "@/lib/ordersStorage";
import type { OrderStatus } from "@/lib/status";

function firstParam(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}

function parseStatus(raw: string | undefined): OrderStatus | "all" {
  if (raw === "available" || raw === "sold" || raw === "picked_up" || raw === "delivered") return raw;
  return "all";
}

function parseLocation(raw: string | undefined): string | "all" | "__none__" {
  if (raw === "__none__") return "__none__";
  if (raw && raw !== "all") return raw;
  return "all";
}

function parsePlant(raw: string | undefined): string | "all" {
  if (raw && raw !== "all") return raw;
  return "all";
}

interface AdminOrdersPageProps {
  searchParams: Promise<{
    status?: string | string[];
    location?: string | string[];
    plant?: string | string[];
  }>;
}

export default async function AdminOrdersPage({ searchParams }: AdminOrdersPageProps) {
  const sp = await searchParams;
  const statusFilter = parseStatus(firstParam(sp.status));
  const locationFilter = parseLocation(firstParam(sp.location));
  const plantFilter = parsePlant(firstParam(sp.plant));

  const allOrders = await readOrders();

  let orders = allOrders.filter((o) => {
    if (statusFilter !== "all" && o.orderStatus !== statusFilter) return false;
    if (plantFilter !== "all" && o.plantId !== plantFilter) return false;
    if (locationFilter !== "all") {
      if (locationFilter === "__none__" && o.locationId !== null) return false;
      if (locationFilter !== "__none__" && o.locationId !== locationFilter) return false;
    }
    return true;
  });

  const hasNoLocationOrder = allOrders.some((o) => o.locationId === null);
  const locationMap = new Map<string, string>();
  for (const o of allOrders) {
    if (o.locationId !== null && !locationMap.has(o.locationId)) {
      locationMap.set(o.locationId, o.locationName ?? o.locationId);
    }
  }
  const locationOptions: FilterOption[] = [];
  if (hasNoLocationOrder) {
    locationOptions.push({ value: "__none__", label: "No location" });
  }
  const sortedLocIds = [...locationMap.keys()].sort((a, b) =>
    (locationMap.get(a) ?? a).localeCompare(locationMap.get(b) ?? b),
  );
  for (const id of sortedLocIds) {
    locationOptions.push({ value: id, label: locationMap.get(id) ?? id });
  }

  const plantMap = new Map<string, string>();
  for (const o of allOrders) {
    if (!plantMap.has(o.plantId)) plantMap.set(o.plantId, o.plantName);
  }
  const plantOptions: FilterOption[] = [...plantMap.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => ({ value, label }));

  return (
    <main
      id="admin-orders-page"
      className="mx-auto min-h-screen w-full max-w-3xl px-4 py-6 pb-10"
    >
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-emerald-950">Orders</h1>
        <AdminOrdersHeaderMenu />
      </div>

      <AdminOrdersFilters
        currentStatus={statusFilter}
        currentLocation={locationFilter}
        currentPlant={plantFilter}
        locationOptions={locationOptions}
        plantOptions={plantOptions}
      />

      {orders.length === 0 ? (
        <p className="rounded-2xl bg-white p-5 text-sm text-slate-600">
          {allOrders.length === 0
            ? "No orders yet."
            : "No orders match the selected filters."}
        </p>
      ) : (
        <ul className="space-y-4">
          {orders.map((order) => (
            <AdminOrderCard key={order.orderId} order={order} />
          ))}
        </ul>
      )}
    </main>
  );
}
