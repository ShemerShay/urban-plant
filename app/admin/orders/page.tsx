/**
 * Local JSON order management is only for prototype/testing and should be replaced
 * with a real database-backed admin before production.
 */

import { AdminOrderCard } from "@/components/admin/AdminOrderCard";
import { AdminOrdersHeaderMenu } from "@/components/admin/AdminOrdersHeaderMenu";
import type { FilterOption } from "@/components/admin/AdminOrdersFilters";
import { AdminOrdersFilters } from "@/components/admin/AdminOrdersFilters";
import {
  filterOrders,
  parseDateParam,
  parseLocation,
  parsePlant,
  parseStatuses,
} from "@/lib/adminOrdersFilterUtils";
import { readOrders } from "@/lib/ordersStorage";

function firstParam(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}

interface AdminOrdersPageProps {
  searchParams: Promise<{
    status?: string | string[];
    location?: string | string[];
    plant?: string | string[];
    dateFrom?: string | string[];
    dateTo?: string | string[];
  }>;
}

export default async function AdminOrdersPage({ searchParams }: AdminOrdersPageProps) {
  const sp = await searchParams;
  const statusFilters = parseStatuses(sp.status);
  const locationFilter = parseLocation(firstParam(sp.location));
  const plantFilter = parsePlant(firstParam(sp.plant));
  const dateFrom = parseDateParam(firstParam(sp.dateFrom));
  const dateTo = parseDateParam(firstParam(sp.dateTo));

  const allOrders = await readOrders();

  const orders = filterOrders(allOrders, {
    statuses: statusFilters,
    location: locationFilter,
    plant: plantFilter,
    dateFrom,
    dateTo,
  });

  const hasNoLocationOrder = allOrders.some((o) => (o.snapshot?.partnerLocationId ?? o.locationId) === null);
  const locationMap = new Map<string, string>();
  for (const o of allOrders) {
    const locationId = o.snapshot?.partnerLocationId ?? o.locationId;
    if (locationId !== null && !locationMap.has(locationId)) {
      locationMap.set(locationId, o.snapshot?.partnerLocationName ?? o.locationName ?? locationId);
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
    const productId = o.snapshot?.productId ?? o.plantId;
    if (!plantMap.has(productId)) plantMap.set(productId, o.snapshot?.productName ?? o.plantName);
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
        <AdminOrdersHeaderMenu filteredOrders={orders} />
      </div>

      <AdminOrdersFilters
        currentStatuses={statusFilters}
        currentLocation={locationFilter}
        currentPlant={plantFilter}
        currentDateFrom={dateFrom}
        currentDateTo={dateTo}
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
