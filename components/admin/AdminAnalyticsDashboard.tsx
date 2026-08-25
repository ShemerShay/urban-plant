import Link from "next/link";
import type { ReactNode } from "react";

import { ANALYTICS_RANGE_OPTIONS } from "@/lib/analytics/dateRange";
import type { BusinessAnalyticsSnapshot } from "@/lib/analytics/businessAnalytics";
import { analyticsRangeLabel } from "@/lib/displayLabels";
import type { Locale } from "@/lib/locale";
import { t } from "@/lib/messages";
import { routes } from "@/lib/routes";

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

function formatPeriodLabel(
  period: string,
  granularity: "hour" | "day" | "week",
  locale: Locale,
): string {
  const raw = period.trim();
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const loc = intlLocale(locale);
  if (granularity === "hour") {
    return d.toLocaleString(loc, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (granularity === "day") {
    return d.toLocaleDateString(loc, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(loc, { month: "short", day: "numeric", year: "numeric" });
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
  rows: { name: string; count: number }[];
  countLabel: string;
  locale: Locale;
}) {
  const peak = maxCount(rows) || 1;
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={`${row.name}-${row.count}`}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium text-slate-800">{row.name}</span>
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

export function AdminAnalyticsDashboard({
  data,
  locale,
}: {
  data: BusinessAnalyticsSnapshot;
  locale: Locale;
}) {
  const activeRange = data.range;
  const emptyMessage = t(locale, "admin.analytics.empty");
  const scansLabel = t(locale, "admin.analytics.colScans");
  const purchasesLabel = t(locale, "admin.analytics.colPurchases");

  return (
    <main
      id="admin-analytics-page"
      className="mx-auto min-h-screen w-full max-w-3xl px-4 py-6 pb-24"
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={routes.admin.index()}
            className="text-sm font-medium text-emerald-800 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700/55"
          >
            {t(locale, "admin.common.backAdmin")}
          </Link>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
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

      <div
        className="mb-6 flex flex-wrap gap-2"
        role="navigation"
        aria-label={t(locale, "admin.analytics.dateRange")}
      >
        {ANALYTICS_RANGE_OPTIONS.map((opt) => {
          const href = routes.admin.analyticsWithRange(opt.key);
          const active = opt.key === activeRange;
          return (
            <Link
              key={opt.key}
              href={href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-full bg-emerald-800 px-3.5 py-2 text-sm font-medium text-white"
                  : "rounded-full bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-[0_8px_30px_rgba(15,23,42,0.04)] hover:bg-slate-50"
              }
            >
              {analyticsRangeLabel(locale, opt.key)}
            </Link>
          );
        })}
      </div>
      {data.neonError ? (
        <div
          className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          role="status"
        >
          {t(locale, "admin.analytics.purchaseUnavailable", { error: data.neonError })}
        </div>
      ) : null}

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
          label={t(locale, "admin.analytics.purchases")}
          value={formatNumber(data.purchases, locale)}
        />
        <KpiCard
          label={t(locale, "admin.analytics.purchasesPlants")}
          value={formatNumber(data.purchasesPlants, locale)}
        />
        <KpiCard
          label={t(locale, "admin.analytics.purchasesFlowers")}
          value={formatNumber(data.purchasesFlowers, locale)}
        />
        <KpiCard
          label={t(locale, "admin.analytics.scanToCheckout")}
          value={formatPercent(data.scanToCheckoutPercent)}
        />
      </div>
      {data.purchasesMissingCatalog != null && data.purchasesMissingCatalog > 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          {t(locale, "admin.analytics.inventoryTypeFallback", {
            count: data.purchasesMissingCatalog,
          })}
        </p>
      ) : null}

      <div className="mt-6 space-y-4">
        <SectionCard
          title={t(locale, "admin.analytics.scansOverTime")}
          empty={data.scansOverTime.length === 0}
          emptyMessage={emptyMessage}
        >
          <ScansOverTimeChart
            points={data.scansOverTime}
            granularity={data.timeGranularity}
            locale={locale}
          />
        </SectionCard>

        <div className="grid gap-4 md:grid-cols-2">
          <SectionCard
            title={t(locale, "admin.analytics.topPlantsScans")}
            empty={data.topPlantsByScans.length === 0}
            emptyMessage={emptyMessage}
          >
            <NamedCountTable
              rows={data.topPlantsByScans}
              countLabel={scansLabel}
              locale={locale}
            />
          </SectionCard>
          <SectionCard
            title={t(locale, "admin.analytics.topPlantsPurchases")}
            empty={data.topPlantsByPurchases.length === 0}
            emptyMessage={emptyMessage}
          >
            <NamedCountTable
              rows={data.topPlantsByPurchases}
              countLabel={purchasesLabel}
              locale={locale}
            />
          </SectionCard>
          <SectionCard
            title={t(locale, "admin.analytics.scansByPartner")}
            empty={data.scansByPartner.length === 0}
            emptyMessage={emptyMessage}
          >
            <NamedCountTable
              rows={data.scansByPartner}
              countLabel={scansLabel}
              locale={locale}
            />
          </SectionCard>
          <SectionCard
            title={t(locale, "admin.analytics.purchasesByPartner")}
            empty={data.purchasesByPartner.length === 0}
            emptyMessage={emptyMessage}
          >
            <NamedCountTable
              rows={data.purchasesByPartner}
              countLabel={purchasesLabel}
              locale={locale}
            />
          </SectionCard>
        </div>

        <SectionCard
          title={t(locale, "admin.analytics.scansByPocket")}
          empty={data.scansByPocket.length === 0}
          emptyMessage={emptyMessage}
        >
          <NamedCountTable rows={data.scansByPocket} countLabel={scansLabel} locale={locale} />
        </SectionCard>
      </div>
    </main>
  );
}
