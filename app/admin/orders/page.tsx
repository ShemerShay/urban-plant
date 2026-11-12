/**
 * Admin order list: Partner/POS cards plus Catalog line visibility
 * and read-only Catalog needs_reconciliation attempts.
 */

import { AdminOrderCard } from "@/components/admin/AdminOrderCard";
import { AdminOrdersHeaderMenu } from "@/components/admin/AdminOrdersHeaderMenu";
import type { FilterOption } from "@/components/admin/AdminOrdersFilters";
import { AdminOrdersFilters } from "@/components/admin/AdminOrdersFilters";
import { AdminReconciliationCard } from "@/components/admin/AdminReconciliationCard";
import {
  catalogItemsRecordFromOrderItems,
  isCatalogAdminOrder,
  reconciliationAttemptViewFromAttempt,
} from "@/lib/adminOrderDisplay";
import {
  parseChannel,
  parseDateParam,
  parseLocation,
  parsePlant,
  parseStatuses,
} from "@/lib/adminOrdersFilterUtils";
import {
  readAdminOrderFilterOptions,
  readAdminOrdersList,
} from "@/lib/adminOrdersList";
import { getLocale } from "@/lib/getLocale";
import type { Locale } from "@/lib/locale";
import { t } from "@/lib/messages";
import { getOrderItemsByOrderIds } from "@/lib/orderItemStorage";
import { listCatalogPaymentAttemptsNeedingReconciliation } from "@/lib/paymentAttemptStorage";

function firstParam(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}

function plantOptionLabel(
  plant: { name: string; nameHe: string | null },
  locale: Locale,
): string {
  if (locale === "he" && plant.nameHe) return plant.nameHe;
  return plant.name;
}

interface AdminOrdersPageProps {
  searchParams: Promise<{
    status?: string | string[];
    channel?: string | string[];
    location?: string | string[];
    plant?: string | string[];
    dateFrom?: string | string[];
    dateTo?: string | string[];
  }>;
}

export default async function AdminOrdersPage({ searchParams }: AdminOrdersPageProps) {
  const locale = await getLocale();
  const sp = await searchParams;
  const statusFilters = parseStatuses(sp.status);
  const channelFilter = parseChannel(firstParam(sp.channel));
  const locationFilter = parseLocation(firstParam(sp.location));
  const plantFilter = parsePlant(firstParam(sp.plant));
  const dateFrom = parseDateParam(firstParam(sp.dateFrom));
  const dateTo = parseDateParam(firstParam(sp.dateTo));

  const filters = {
    statuses: statusFilters,
    channel: channelFilter,
    location: locationFilter,
    plant: plantFilter,
    dateFrom,
    dateTo,
  };

  const [orders, filterOptions, reconciliationAttempts] = await Promise.all([
    readAdminOrdersList(filters),
    readAdminOrderFilterOptions(),
    listCatalogPaymentAttemptsNeedingReconciliation(),
  ]);

  const catalogOrderIds = orders.filter(isCatalogAdminOrder).map((order) => order.orderId);
  const itemsByOrderId = await getOrderItemsByOrderIds(catalogOrderIds);
  const catalogItemsByOrderId = catalogItemsRecordFromOrderItems(
    itemsByOrderId,
    catalogOrderIds,
  );

  const locationOptions: FilterOption[] = [];
  if (filterOptions.hasNoLocationOrder) {
    locationOptions.push({ value: "__none__", label: t(locale, "admin.orders.noLocation") });
  }
  for (const location of filterOptions.locations) {
    locationOptions.push({ value: location.id, label: location.name });
  }

  const plantOptions: FilterOption[] = filterOptions.plants.map((plant) => ({
    value: plant.id,
    label: plantOptionLabel(plant, locale),
  }));

  const reconciliationViews = reconciliationAttempts.map(reconciliationAttemptViewFromAttempt);

  return (
    <main
      id="admin-orders-page"
      className="mx-auto min-h-screen w-full max-w-3xl px-4 py-6 pb-10"
    >
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-emerald-950">
          {t(locale, "admin.orders.title")}
        </h1>
        <AdminOrdersHeaderMenu
          filteredOrders={orders}
          catalogItemsByOrderId={catalogItemsByOrderId}
        />
      </div>

      <AdminOrdersFilters
        currentStatuses={statusFilters}
        currentChannel={channelFilter}
        currentLocation={locationFilter}
        currentPlant={plantFilter}
        currentDateFrom={dateFrom}
        currentDateTo={dateTo}
        locationOptions={locationOptions}
        plantOptions={plantOptions}
      />

      {reconciliationViews.length > 0 ? (
        <section className="mb-8" aria-labelledby="admin-orders-reconciliation-heading">
          <h2
            id="admin-orders-reconciliation-heading"
            className="text-lg font-semibold text-amber-950"
          >
            {t(locale, "admin.orders.reviewTitle")}
          </h2>
          <p className="mt-1 mb-4 text-sm text-slate-600">
            {t(locale, "admin.orders.reviewHint")}
          </p>
          <ul className="space-y-4">
            {reconciliationViews.map((attempt) => (
              <AdminReconciliationCard key={attempt.id} attempt={attempt} />
            ))}
          </ul>
        </section>
      ) : null}

      {orders.length === 0 ? (
        <p className="rounded-2xl bg-white p-5 text-sm text-slate-600">
          {!filterOptions.hasAnyOrders
            ? t(locale, "admin.orders.empty")
            : t(locale, "admin.orders.noMatch")}
        </p>
      ) : (
        <ul className="space-y-4">
          {orders.map((order) => (
            <AdminOrderCard
              key={order.orderId}
              order={order}
              catalogItems={catalogItemsByOrderId[order.orderId] ?? []}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
