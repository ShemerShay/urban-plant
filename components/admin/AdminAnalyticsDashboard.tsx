import type { ReactNode } from "react";

import { AdminAnalyticsFilters } from "@/components/admin/AdminAnalyticsFilters";
import { analyticsQueryUrl, type AnalyticsArea } from "@/lib/analytics/analyticsQuery";
import type { BusinessAnalyticsSnapshot } from "@/lib/analytics/businessAnalytics";
import { formatInstantInBusinessTimeZone } from "@/lib/dateFilter";
import type { Locale } from "@/lib/locale";
import { t } from "@/lib/messages";

function intlLocale(locale: Locale): string {
  return locale === "he" ? "he-IL" : "en-US";
}

function formatNumber(n: number | null, locale: Locale): string {
  if (n === null) return "—";
  return new Intl.NumberFormat(intlLocale(locale)).format(n);
}

function formatPercent(n: number | null): string {
  if (n === null) return "—";
  return `${n}%`;
}

function formatMoney(n: number | null, locale: Locale): string {
  if (n === null) return "—";
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  }).format(n);
}

function parseUtcPeriodInstant(period: string): Date | null {
  const raw = period.trim();
  if (!raw) return null;
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const hasZone = /[zZ]$/.test(iso) || /[+-]\d{2}:?\d{2}$/.test(iso);
  const d = new Date(hasZone ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatPeriodLabel(
  period: string,
  granularity: "hour" | "day" | "week",
  locale: Locale,
): string {
  const d = parseUtcPeriodInstant(period);
  if (!d) return period.trim() || "—";
  const loc = intlLocale(locale);
  if (granularity === "hour") {
    return formatInstantInBusinessTimeZone(d, loc, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (granularity === "day") {
    return formatInstantInBusinessTimeZone(d, loc, { month: "short", day: "numeric" });
  }
  return formatInstantInBusinessTimeZone(d, loc, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function maxCount(items: { count?: number; scans?: number }[]): number {
  let m = 0;
  for (const item of items) {
    const v = "scans" in item && typeof item.scans === "number" ? item.scans : item.count ?? 0;
    if (v > m) m = v;
  }
  return m;
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-3xl bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.04)] sm:p-5">
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-emerald-950 sm:text-3xl">
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</p> : null}
    </div>
  );
}

function SectionCard({
  title,
  children,
  empty,
  emptyMessage,
}: {
  title: string;
  children: ReactNode;
  empty?: boolean;
  emptyMessage: string;
}) {
  return (
    <section className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
      <h2 className="text-base font-semibold text-emerald-950">{title}</h2>
      <div className="mt-4">
        {empty ? <p className="text-sm text-slate-500">{emptyMessage}</p> : children}
      </div>
    </section>
  );
}

function NamedCountTable({
  rows,
  countLabel,
  locale,
}: {
  rows: { name: string; count: number; href?: string }[];
  countLabel: string;
  locale: Locale;
}) {
  const peak = maxCount(rows) || 1;
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={`${row.href ?? row.name}-${row.count}`}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            {row.href ? (
              <a href={row.href} className="min-w-0 truncate font-medium text-emerald-900 underline-offset-2 hover:underline">
                {row.name}
              </a>
            ) : (
              <span className="min-w-0 truncate font-medium text-slate-800">{row.name}</span>
            )}
            <span className="shrink-0 tabular-nums text-slate-600">
              {formatNumber(row.count, locale)} {countLabel}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-600/80"
              style={{ width: `${Math.max(4, (row.count / peak) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ScansOverTimeChart({
  points,
  granularity,
  locale,
}: {
  points: { period: string; scans: number }[];
  granularity: "hour" | "day" | "week";
  locale: Locale;
}) {
  const peak = maxCount(points) || 1;
  return (
    <ul className="space-y-2">
      {points.map((p) => (
        <li key={p.period} className="flex items-center gap-3 text-sm">
          <span className="w-28 shrink-0 text-slate-600 sm:w-36">
            {formatPeriodLabel(p.period, granularity, locale)}
          </span>
          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-700/75"
              style={{ width: `${Math.max(4, (p.scans / peak) * 100)}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right tabular-nums text-slate-700">
            {formatNumber(p.scans, locale)}
          </span>
        </li>
      ))}
    </ul>
  );
}

const AREAS: AnalyticsArea[] = ["overall", "logistics", "financial"];

const AREA_LABEL = {
  overall: "admin.analytics.area.overall",
  logistics: "admin.analytics.area.logistics",
  financial: "admin.analytics.area.financial",
} as const;

export function AdminAnalyticsDashboard({
  data,
  locale,
  partners,
}: {
  data: BusinessAnalyticsSnapshot;
  locale: Locale;
  partners: { id: string; name: string }[];
}) {
  const emptyMessage = t(locale, "admin.analytics.empty");
  const scansLabel = t(locale, "admin.analytics.colScans");
  const purchasesLabel = t(locale, "admin.analytics.colPurchases");
  const showInventorySplit = data.inventoryType === "all";

  return (
    <main
      id="admin-analytics-page"
      className="mx-auto min-h-screen w-full max-w-3xl px-4 py-6 pb-24"
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
            {t(locale, "admin.brand")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-emerald-950">
            {t(locale, "admin.analytics.title")}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-600">
            {t(locale, "admin.analytics.subtitle")}
          </p>
        </div>
      </div>

      <AdminAnalyticsFilters
        inventoryType={data.inventoryType}
        dateFilter={data.dateFilter}
        partnerId={data.partnerId}
        area={data.area}
        partners={partners}
      />

      <nav className="mb-6 flex gap-2" aria-label={t(locale, "admin.analytics.title")}>
        {AREAS.map((area) => {
          const selected = data.area === area;
          return (
            <a
              key={area}
              href={analyticsQueryUrl({
                inventoryType: data.inventoryType,
                dateFilter: data.dateFilter,
                partnerId: data.partnerId,
                area,
              })}
              aria-current={selected ? "page" : undefined}
              className={
                selected
                  ? "rounded-full bg-emerald-800 px-4 py-2 text-sm font-semibold text-white"
                  : "rounded-full bg-white px-4 py-2 text-sm font-semibold text-emerald-900 shadow-[0_8px_30px_rgba(15,23,42,0.04)]"
              }
            >
              {t(locale, AREA_LABEL[area])}
            </a>
          );
        })}
      </nav>

      {data.posthogError || data.neonError ? (
        <p className="mb-4 text-sm leading-relaxed text-slate-600" role="status">
          {t(locale, "admin.analytics.sourceError")}
        </p>
      ) : null}

      {data.area === "overall" ? (
        <OverallSection
          data={data}
          locale={locale}
          emptyMessage={emptyMessage}
          purchasesLabel={purchasesLabel}
          showInventorySplit={showInventorySplit}
        />
      ) : null}
      {data.area === "logistics" ? (
        <LogisticsSection
          data={data}
          locale={locale}
          emptyMessage={emptyMessage}
          scansLabel={scansLabel}
        />
      ) : null}
      {data.area === "financial" ? (
        <FinancialSection data={data} locale={locale} emptyMessage={emptyMessage} />
      ) : null}
    </main>
  );
}

function OverallSection({
  data,
  locale,
  emptyMessage,
  purchasesLabel,
  showInventorySplit,
}: {
  data: BusinessAnalyticsSnapshot;
  locale: Locale;
  emptyMessage: string;
  purchasesLabel: string;
  showInventorySplit: boolean;
}) {
  const partnerScope = data.partnerId != null;
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label={t(locale, "admin.analytics.purchases")}
          value={formatNumber(data.purchases, locale)}
        />
        <KpiCard
          label={t(locale, "admin.analytics.revenue")}
          value={formatMoney(data.revenue, locale)}
        />
        <KpiCard
          label={t(locale, "admin.analytics.units")}
          value={formatNumber(data.units, locale)}
        />
        <KpiCard
          label={t(locale, "admin.analytics.averageOrderValue")}
          value={formatMoney(data.averageOrderValue, locale)}
        />
        {partnerScope ? null : (
          <>
            <KpiCard
              label={t(locale, "admin.analytics.purchasesCatalog")}
              value={formatNumber(data.purchasesCatalog, locale)}
            />
            <KpiCard
              label={t(locale, "admin.analytics.purchasesPartner")}
              value={formatNumber(data.purchasesPartner, locale)}
            />
          </>
        )}
        {showInventorySplit ? (
          <>
            <KpiCard
              label={t(locale, "admin.analytics.purchasesPlants")}
              value={formatNumber(data.purchasesPlants, locale)}
            />
            <KpiCard
              label={t(locale, "admin.analytics.purchasesFlowers")}
              value={formatNumber(data.purchasesFlowers, locale)}
            />
          </>
        ) : null}
        <KpiCard
          label={t(locale, "admin.analytics.scanToCheckout")}
          value={formatPercent(data.scanToCheckoutPercent)}
        />
      </div>
      {showInventorySplit &&
      data.purchasesMissingCatalog != null &&
      data.purchasesMissingCatalog > 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          {t(locale, "admin.analytics.inventoryTypeFallback", {
            count: data.purchasesMissingCatalog,
          })}
        </p>
      ) : null}
      <div className="mt-6 space-y-4">
        <SectionCard
          title={t(locale, "admin.analytics.ordersOverTime")}
          empty={data.ordersOverTime.length === 0}
          emptyMessage={emptyMessage}
        >
          <ul className="space-y-2">
            {data.ordersOverTime.map((point) => (
              <li key={point.period} className="flex justify-between text-sm text-slate-700">
                <span>{point.period}</span>
                <span className="tabular-nums">{formatNumber(point.count, locale)}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
        <SectionCard
          title={t(locale, "admin.analytics.topProductsPurchases")}
          empty={data.topPlantsByPurchases.length === 0}
          emptyMessage={emptyMessage}
        >
          <NamedCountTable
            rows={data.topPlantsByPurchases}
            countLabel={purchasesLabel}
            locale={locale}
          />
        </SectionCard>
        {partnerScope ? null : (
          <SectionCard
            title={t(locale, "admin.analytics.purchasesByPartner")}
            empty={data.purchasesByPartner.length === 0}
            emptyMessage={emptyMessage}
          >
            <NamedCountTable
              rows={data.purchasesByPartner.map((row) => ({
                name: row.name,
                count: row.count,
                href: analyticsQueryUrl({
                  inventoryType: data.inventoryType,
                  dateFilter: data.dateFilter,
                  partnerId: row.id,
                  area: "overall",
                }),
              }))}
              countLabel={purchasesLabel}
              locale={locale}
            />
          </SectionCard>
        )}
      </div>
    </div>
  );
}

function LogisticsSection({
  data,
  locale,
  emptyMessage,
  scansLabel,
}: {
  data: BusinessAnalyticsSnapshot;
  locale: Locale;
  emptyMessage: string;
  scansLabel: string;
}) {
  const partnerScope = data.partnerId != null;
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label={t(locale, "admin.analytics.totalScans")}
          value={formatNumber(data.totalScans, locale)}
        />
        <KpiCard
          label={t(locale, "admin.analytics.uniqueScanners")}
          value={formatNumber(data.uniqueScanners, locale)}
          hint={t(locale, "admin.analytics.uniqueDevices")}
        />
        <KpiCard
          label={t(locale, "admin.analytics.checkoutStarted")}
          value={formatNumber(data.checkoutStarted, locale)}
        />
        <KpiCard
          label={t(locale, "admin.analytics.paymentStarted")}
          value={formatNumber(data.paymentStarted, locale)}
        />
        <KpiCard
          label={t(locale, "admin.analytics.scanToCheckout")}
          value={formatPercent(data.scanToCheckoutPercent)}
        />
        <KpiCard
          label={t(locale, "admin.analytics.units")}
          value={formatNumber(data.units, locale)}
        />
        <KpiCard
          label={t(locale, "admin.analytics.failedAttempts")}
          value={formatNumber(data.failedAttempts, locale)}
        />
        <KpiCard
          label={t(locale, "admin.analytics.expiredAttempts")}
          value={formatNumber(data.expiredAttempts, locale)}
        />
        <KpiCard
          label={t(locale, "admin.analytics.needsReconciliation")}
          value={formatNumber(data.needsReconciliation, locale)}
        />
        {partnerScope || data.inventoryType === "flowers" ? null : (
          <KpiCard
            label={t(locale, "admin.analytics.catalogVisitors")}
            value={formatNumber(data.catalogVisitors, locale)}
            hint={t(locale, "admin.analytics.catalogSessions", {
              count: formatNumber(data.catalogSessions, locale),
            })}
          />
        )}
        {partnerScope ? null : (
          <>
            <KpiCard
              label={t(locale, "admin.analytics.catalogCheckoutStarted")}
              value={formatNumber(data.catalogCheckoutStarted, locale)}
            />
            <KpiCard
              label={t(locale, "admin.analytics.catalogPaymentStarted")}
              value={formatNumber(data.catalogPaymentStarted, locale)}
            />
          </>
        )}
      </div>
      <div className="mt-6 space-y-4">
        <SectionCard
          title={t(locale, "admin.analytics.scansOverTime")}
          empty={data.scansOverTimeError != null || data.scansOverTime.length === 0}
          emptyMessage={
            data.scansOverTimeError != null
              ? t(locale, "admin.analytics.scansOverTimeUnavailable")
              : emptyMessage
          }
        >
          <ScansOverTimeChart
            points={data.scansOverTime}
            granularity={data.timeGranularity}
            locale={locale}
          />
        </SectionCard>
        <div className="grid gap-4 md:grid-cols-2">
          <SectionCard
            title={t(locale, "admin.analytics.topProductsScans")}
            empty={data.topPlantsByScans.length === 0}
            emptyMessage={emptyMessage}
          >
            <NamedCountTable rows={data.topPlantsByScans} countLabel={scansLabel} locale={locale} />
          </SectionCard>
          {partnerScope ? (
            <SectionCard
              title={t(locale, "admin.analytics.scansByLocation")}
              empty={data.scansByLocation.length === 0}
              emptyMessage={emptyMessage}
            >
              <NamedCountTable rows={data.scansByLocation} countLabel={scansLabel} locale={locale} />
            </SectionCard>
          ) : (
            <SectionCard
              title={t(locale, "admin.analytics.scansByPartner")}
              empty={data.scansByPartner.length === 0}
              emptyMessage={emptyMessage}
            >
              <NamedCountTable rows={data.scansByPartner} countLabel={scansLabel} locale={locale} />
            </SectionCard>
          )}
        </div>
        <SectionCard
          title={t(locale, "admin.analytics.scansByPocket")}
          empty={data.scansByPocket.length === 0}
          emptyMessage={emptyMessage}
        >
          <NamedCountTable rows={data.scansByPocket} countLabel={scansLabel} locale={locale} />
        </SectionCard>
        {partnerScope ? (
          <SectionCard
            title={t(locale, "admin.analytics.purchasesByLocation")}
            empty={data.purchasesByLocation.length === 0}
            emptyMessage={emptyMessage}
          >
            <NamedCountTable
              rows={data.purchasesByLocation}
              countLabel={t(locale, "admin.analytics.colPurchases")}
              locale={locale}
            />
          </SectionCard>
        ) : null}
      </div>
    </div>
  );
}

function FinancialSection({
  data,
  locale,
  emptyMessage,
}: {
  data: BusinessAnalyticsSnapshot;
  locale: Locale;
  emptyMessage: string;
}) {
  const partnerScope = data.partnerId != null;
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label={t(locale, "admin.analytics.revenue")}
          value={formatMoney(data.revenue, locale)}
        />
        <KpiCard
          label={t(locale, "admin.analytics.purchases")}
          value={formatNumber(data.purchases, locale)}
        />
        <KpiCard
          label={t(locale, "admin.analytics.averageOrderValue")}
          value={formatMoney(data.averageOrderValue, locale)}
        />
        {partnerScope ? null : (
          <>
            <KpiCard
              label={t(locale, "admin.analytics.revenueCatalog")}
              value={formatMoney(data.revenueCatalog, locale)}
            />
            <KpiCard
              label={t(locale, "admin.analytics.revenuePartner")}
              value={formatMoney(data.revenuePartner, locale)}
            />
          </>
        )}
      </div>
      {partnerScope ? null : (
      <div className="mt-6 space-y-4">
          <SectionCard
            title={t(locale, "admin.analytics.revenueByPartner")}
            empty={data.purchasesByPartner.length === 0}
            emptyMessage={emptyMessage}
          >
            <ul className="space-y-3">
              {data.purchasesByPartner.map((row) => (
                <li key={row.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <a
                    href={analyticsQueryUrl({
                      inventoryType: data.inventoryType,
                      dateFilter: data.dateFilter,
                      partnerId: row.id,
                      area: "financial",
                    })}
                    className="min-w-0 truncate font-medium text-emerald-900 underline-offset-2 hover:underline"
                  >
                    {row.name}
                  </a>
                  <span className="shrink-0 tabular-nums text-slate-600">
                    {formatMoney(row.revenue, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </SectionCard>
      </div>
      )}
    </div>
  );
}
