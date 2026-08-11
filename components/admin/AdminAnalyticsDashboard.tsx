import Link from "next/link";
import type { ReactNode } from "react";

import {
  ANALYTICS_RANGE_OPTIONS,
} from "@/lib/analytics/dateRange";
import type { BusinessAnalyticsSnapshot } from "@/lib/analytics/businessAnalytics";
import { routes } from "@/lib/routes";

function formatNumber(n: number | null): string {
  if (n === null) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

function formatPercent(n: number | null): string {
  if (n === null) return "—";
  return `${n}%`;
}

function formatPeriodLabel(period: string, granularity: "hour" | "day" | "week"): string {
  const raw = period.trim();
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  if (granularity === "hour") {
    return d.toLocaleString("en-GB", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (granularity === "day") {
    return d.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-GB", { month: "short", day: "numeric", year: "numeric" });
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
}: {
  title: string;
  children: ReactNode;
  empty?: boolean;
}) {
  return (
    <section className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
      <h2 className="text-base font-semibold text-emerald-950">{title}</h2>
      <div className="mt-4">{empty ? <p className="text-sm text-slate-500">No data in this range.</p> : children}</div>
    </section>
  );
}

function NamedCountTable({
  rows,
  countLabel,
}: {
  rows: { name: string; count: number }[];
  countLabel: string;
}) {
  const peak = maxCount(rows) || 1;
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={`${row.name}-${row.count}`}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium text-slate-800">{row.name}</span>
            <span className="shrink-0 tabular-nums text-slate-600">
              {formatNumber(row.count)} {countLabel}
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
}: {
  points: { period: string; scans: number }[];
  granularity: "hour" | "day" | "week";
}) {
  const peak = maxCount(points) || 1;
  return (
    <ul className="space-y-2">
      {points.map((p) => (
        <li key={p.period} className="flex items-center gap-3 text-sm">
          <span className="w-28 shrink-0 text-slate-600 sm:w-36">
            {formatPeriodLabel(p.period, granularity)}
          </span>
          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-700/75"
              style={{ width: `${Math.max(4, (p.scans / peak) * 100)}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right tabular-nums text-slate-700">
            {formatNumber(p.scans)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AdminAnalyticsDashboard({
  data,
}: {
  data: BusinessAnalyticsSnapshot;
}) {
  const activeRange = data.range;

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
            ← Admin
          </Link>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
            Urban Plant · Admin
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-emerald-950">Analytics</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-600">
            Scans from PostHog. Purchases from verified successful orders.
          </p>
        </div>
      </div>

      <div
        className="mb-6 flex flex-wrap gap-2"
        role="navigation"
        aria-label="Date range"
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
              {opt.label}
            </Link>
          );
        })}
      </div>

      {data.posthogError ? (
        <div
          className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          role="status"
        >
          PostHog metrics unavailable: {data.posthogError}
        </div>
      ) : null}
      {data.neonError ? (
        <div
          className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          role="status"
        >
          Purchase metrics unavailable: {data.neonError}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total scans" value={formatNumber(data.totalScans)} />
        <KpiCard
          label="Unique scanners"
          value={formatNumber(data.uniqueScanners)}
          hint="Unique browsers/devices"
        />
        <KpiCard label="Purchases" value={formatNumber(data.purchases)} />
        <KpiCard
          label="Scan → Checkout"
          value={formatPercent(data.scanToCheckoutPercent)}
        />
      </div>

      <div className="mt-6 space-y-4">
        <SectionCard title="Scans over time" empty={data.scansOverTime.length === 0}>
          <ScansOverTimeChart
            points={data.scansOverTime}
            granularity={data.timeGranularity}
          />
        </SectionCard>

        <div className="grid gap-4 md:grid-cols-2">
          <SectionCard
            title="Top plants by scans"
            empty={data.topPlantsByScans.length === 0}
          >
            <NamedCountTable rows={data.topPlantsByScans} countLabel="scans" />
          </SectionCard>
          <SectionCard
            title="Top plants by purchases"
            empty={data.topPlantsByPurchases.length === 0}
          >
            <NamedCountTable rows={data.topPlantsByPurchases} countLabel="purchases" />
          </SectionCard>
          <SectionCard title="Scans by partner" empty={data.scansByPartner.length === 0}>
            <NamedCountTable rows={data.scansByPartner} countLabel="scans" />
          </SectionCard>
          <SectionCard
            title="Purchases by partner"
            empty={data.purchasesByPartner.length === 0}
          >
            <NamedCountTable rows={data.purchasesByPartner} countLabel="purchases" />
          </SectionCard>
        </div>

        <SectionCard title="Scans by pocket" empty={data.scansByPocket.length === 0}>
          <NamedCountTable rows={data.scansByPocket} countLabel="scans" />
        </SectionCard>
      </div>
    </main>
  );
}
