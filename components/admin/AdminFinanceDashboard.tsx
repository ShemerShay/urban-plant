"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import { formatFinanceMoney as formatMoney } from "@/lib/finance/format";
import { financePageHref } from "@/lib/finance/query";
import type { FinanceView } from "@/lib/finance/view";
import {
  FINANCE_ACTIVITY_FILTERS,
  FINANCE_CATEGORIES,
  MANUAL_FINANCE_KINDS,
  type FinanceActivityFilter,
  type FinanceActivityPayment,
  type FinanceActivitySource,
  type FinanceActivityType,
  type FinanceCategory,
  type ManualFinanceKind,
} from "@/lib/finance/types";
import type { Locale } from "@/lib/locale";
import { t, type MessageKey } from "@/lib/messages";
import { routes } from "@/lib/routes";

const inputClassName = "mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900";
const labelClassName = "text-xs font-medium text-slate-500";

const KIND_KEYS: Record<FinanceActivityType | ManualFinanceKind, MessageKey> = {
  order: "admin.finance.kind.order",
  expense: "admin.finance.kind.expense",
  other_income: "admin.finance.kind.other_income",
  inventory_purchase: "admin.finance.kind.inventory_purchase",
  historical_settlement: "admin.finance.kind.historical_settlement",
  unmatched: "admin.finance.kind.unmatched",
};

const FILTER_KEYS: Record<FinanceActivityFilter, MessageKey> = {
  all: "admin.finance.filter.all",
  order: "admin.finance.filter.order",
  expense: "admin.finance.filter.expense",
  other_income: "admin.finance.filter.other_income",
  inventory_purchase: "admin.finance.filter.inventory_purchase",
  historical_settlement: "admin.finance.filter.historical_settlement",
  unmatched: "admin.finance.filter.unmatched",
};

const CATEGORY_KEYS: Record<FinanceCategory, MessageKey> = {
  inventory: "admin.finance.category.inventory",
  setup_fixtures: "admin.finance.category.setup_fixtures",
  marketing_signage: "admin.finance.category.marketing_signage",
  software_systems: "admin.finance.category.software_systems",
  professional_services: "admin.finance.category.professional_services",
  maintenance_tools: "admin.finance.category.maintenance_tools",
  travel: "admin.finance.category.travel",
  other: "admin.finance.category.other",
};

const PAYMENT_KEYS: Record<FinanceActivityPayment, MessageKey> = {
  paid: "admin.finance.payment.paid",
  unpaid: "admin.finance.payment.unpaid",
  unmatched: "admin.finance.payment.unmatched",
  settled: "admin.finance.payment.settled",
};

const SOURCE_KEYS: Record<FinanceActivitySource, MessageKey> = {
  order: "admin.finance.source.order",
  manual: "admin.finance.source.manual",
  import: "admin.finance.source.import",
  payment_attempt: "admin.finance.source.payment_attempt",
};

function formatMonth(month: string, locale: Locale): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  return new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-semibold tabular-nums text-emerald-950">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 rounded-3xl bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
      <h2 className="text-sm font-semibold text-emerald-950">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function AdminFinanceDashboard({
  view,
  partners,
  locale,
}: {
  view: FinanceView;
  partners: { id: string; name: string }[];
  locale: Locale;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<ManualFinanceKind>("expense");
  const [allocatingId, setAllocatingId] = useState<string | null>(null);
  const maxBar = Math.max(1, ...view.monthly.flatMap((point) => [point.income, point.expenses]));

  function go(next: { month?: string; activity?: FinanceActivityFilter }) {
    router.push(
      financePageHref({
        month: next.month ?? view.month,
        activity: next.activity ?? view.activity,
      }),
    );
  }

  async function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(routes.api.financeEntries(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          amount: Number(form.get("amount")),
          occurredOn: String(form.get("occurredOn") ?? ""),
          description: String(form.get("description") ?? ""),
          category: kind === "expense" ? String(form.get("category") ?? "") : null,
          partnerId: String(form.get("partnerId") ?? ""),
          paymentStatus: String(form.get("paymentStatus") ?? ""),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error || t(locale, "admin.finance.saveFailed"));
        return;
      }
      setCreating(false);
      router.refresh();
    } catch {
      setError(t(locale, "admin.finance.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function submitAllocation(event: FormEvent<HTMLFormElement>, purchaseId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(routes.api.financeEntryAllocations(purchaseId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(form.get("amount")),
          occurredOn: String(form.get("occurredOn") ?? ""),
          description: String(form.get("description") ?? ""),
          partnerId: String(form.get("partnerId") ?? ""),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error || t(locale, "admin.finance.saveFailed"));
        return;
      }
      setAllocatingId(null);
      router.refresh();
    } catch {
      setError(t(locale, "admin.finance.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(url: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error || t(locale, "admin.finance.saveFailed"));
        return;
      }
      router.refresh();
    } catch {
      setError(t(locale, "admin.finance.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="admin-finance-page" className="mx-auto min-h-screen w-full max-w-5xl px-4 py-6 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-emerald-950">{t(locale, "admin.finance.title")}</h1>
          <p className="mt-1 max-w-xl text-sm text-slate-600">{t(locale, "admin.finance.subtitle")}</p>
        </div>
        <button
          type="button"
          className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
          onClick={() => {
            setCreating((open) => !open);
            setError(null);
          }}
        >
          {t(locale, "admin.finance.newTransaction")}
        </button>
      </div>

      {creating ? (
        <form className="mt-4 grid gap-3 rounded-3xl bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.04)] sm:grid-cols-2" onSubmit={submitEntry}>
          <label>
            <span className={labelClassName}>{t(locale, "admin.finance.kind")}</span>
            <select className={inputClassName} value={kind} onChange={(event) => setKind(event.target.value as ManualFinanceKind)}>
              {MANUAL_FINANCE_KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(locale, KIND_KEYS[value])}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelClassName}>{t(locale, "admin.finance.amount")}</span>
            <input className={inputClassName} name="amount" type="number" min="0.01" step="0.01" required />
          </label>
          <label>
            <span className={labelClassName}>{t(locale, "admin.finance.date")}</span>
            <input className={inputClassName} name="occurredOn" type="date" required />
          </label>
          <label>
            <span className={labelClassName}>{t(locale, "admin.finance.paymentStatus")}</span>
            <select className={inputClassName} name="paymentStatus" defaultValue="paid">
              <option value="paid">{t(locale, "admin.finance.payment.paid")}</option>
              <option value="unpaid">{t(locale, "admin.finance.payment.unpaid")}</option>
            </select>
          </label>
          <label className="sm:col-span-2">
            <span className={labelClassName}>{t(locale, "admin.finance.description")}</span>
            <input className={inputClassName} name="description" required maxLength={500} />
          </label>
          {kind === "expense" ? (
            <label>
              <span className={labelClassName}>{t(locale, "admin.finance.category")}</span>
              <select className={inputClassName} name="category" required defaultValue="other">
                {FINANCE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {t(locale, CATEGORY_KEYS[category])}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            <span className={labelClassName}>{t(locale, "admin.finance.partner")}</span>
            <select className={inputClassName} name="partnerId" defaultValue="">
              <option value="">{t(locale, "admin.finance.partnerNone")}</option>
              {partners.map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {partner.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2 sm:col-span-2">
            <button type="submit" className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy}>
              {busy ? t(locale, "admin.finance.saving") : t(locale, "admin.finance.save")}
            </button>
            <button type="button" className="rounded-xl px-4 py-2 text-sm text-slate-600" onClick={() => setCreating(false)}>
              {t(locale, "admin.finance.cancel")}
            </button>
          </div>
        </form>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label>
          <span className={labelClassName}>{t(locale, "admin.finance.month")}</span>
          <input
            className={inputClassName}
            type="month"
            value={view.month === "all" ? "" : view.month}
            onChange={(event) => go({ month: event.target.value || "all" })}
          />
        </label>
        <button type="button" className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700" onClick={() => go({ month: "all" })}>
          {t(locale, "admin.finance.allTime")}
        </button>
        <label>
          <span className={labelClassName}>{t(locale, "admin.finance.type")}</span>
          <select
            className={inputClassName}
            value={view.activity}
            aria-label={t(locale, "admin.finance.type")}
            onChange={(event) => go({ activity: event.target.value as FinanceActivityFilter })}
          >
            {FINANCE_ACTIVITY_FILTERS.map((filter) => (
              <option key={filter} value={filter}>
                {t(locale, FILTER_KEYS[filter])}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t(locale, "admin.finance.orderRevenue")} value={formatMoney(view.orderRevenue, locale)} />
        <Kpi label={t(locale, "admin.finance.otherIncome")} value={formatMoney(view.otherIncome, locale)} />
        <Kpi label={t(locale, "admin.finance.expenses")} value={formatMoney(view.expenses, locale)} />
        <Kpi label={t(locale, "admin.finance.operatingResult")} value={formatMoney(view.operatingResult, locale)} />
        {view.openObligations > 0 ? (
          <Kpi label={t(locale, "admin.finance.openObligations")} value={formatMoney(view.openObligations, locale)} />
        ) : null}
      </div>

      {view.unmatchedCount > 0 ? (
        <p className="mt-4 text-sm text-amber-900">
          <button type="button" className="underline" onClick={() => go({ activity: "unmatched" })}>
            {t(locale, "admin.finance.unmatchedSummary", {
              count: view.unmatchedCount,
              amount: formatMoney(view.unmatchedAmount, locale),
            })}
          </button>
        </p>
      ) : null}

      <Section title={t(locale, "admin.finance.incomeVsExpenses")}>
        {view.monthly.length === 0 ? (
          <p className="text-sm text-slate-500">{t(locale, "admin.finance.empty")}</p>
        ) : (
          <ul className="space-y-3">
            {view.monthly.map((point) => (
              <li key={point.month}>
                <p className="text-xs font-medium text-slate-500">{formatMonth(point.month, locale)}</p>
                <div className="mt-1 space-y-1">
                  <Bar label={t(locale, "admin.finance.income")} value={point.income} max={maxBar} locale={locale} tone="bg-emerald-600" />
                  <Bar label={t(locale, "admin.finance.expenses")} value={point.expenses} max={maxBar} locale={locale} tone="bg-slate-400" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t(locale, "admin.finance.expensesByCategory")}>
        {view.expensesByCategory.length === 0 ? (
          <p className="text-sm text-slate-500">{t(locale, "admin.finance.empty")}</p>
        ) : (
          <ul className="space-y-2">
            {view.expensesByCategory.map((row) => (
              <li key={row.category} className="flex items-baseline justify-between gap-3 text-sm">
                <span>{t(locale, CATEGORY_KEYS[row.category])}</span>
                <span className="tabular-nums text-slate-700">{formatMoney(row.amount, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t(locale, "admin.finance.partnerSummary")}>
        {view.partners.length === 0 ? (
          <p className="text-sm text-slate-500">{t(locale, "admin.finance.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">{t(locale, "admin.finance.colPartner")}</th>
                  <th className="py-2 pr-3 font-medium">{t(locale, "admin.finance.colOrderRevenue")}</th>
                  <th className="py-2 pr-3 font-medium">{t(locale, "admin.finance.colOtherIncome")}</th>
                  <th className="py-2 pr-3 font-medium">{t(locale, "admin.finance.colExpenses")}</th>
                  <th className="py-2 pr-3 font-medium">{t(locale, "admin.finance.colResult")}</th>
                  <th className="py-2 pr-3 font-medium">{t(locale, "admin.finance.colAllocated")}</th>
                  <th className="py-2 font-medium">{t(locale, "admin.finance.colTotalInvested")}</th>
                </tr>
              </thead>
              <tbody>
                {view.partners.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="py-2 pr-3">{row.name}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatMoney(row.orderRevenue, locale)}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatMoney(row.otherIncome, locale)}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatMoney(row.expenses, locale)}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatMoney(row.result, locale)}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatMoney(row.allocated, locale)}</td>
                    <td className="py-2 tabular-nums">{formatMoney(row.totalInvested, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={t(locale, "admin.finance.investment")}>
        <div className="grid grid-cols-3 gap-3">
          <Kpi label={t(locale, "admin.finance.purchased")} value={formatMoney(view.purchased, locale)} />
          <Kpi label={t(locale, "admin.finance.allocated")} value={formatMoney(view.allocated, locale)} />
          <Kpi label={t(locale, "admin.finance.remaining")} value={formatMoney(view.remaining, locale)} />
        </div>
        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t(locale, "admin.finance.purchaseHistory")}
        </h3>
        {view.purchases.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">{t(locale, "admin.finance.empty")}</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {view.purchases.map((purchase) => (
              <li key={purchase.id} className="rounded-2xl border border-slate-100 p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p>
                    <span className="text-slate-500">{purchase.occurredOn}</span> {purchase.description}
                  </p>
                  <p className="tabular-nums">{formatMoney(purchase.amount, locale)}</p>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {t(locale, "admin.finance.left")}: {formatMoney(purchase.remaining, locale)}
                </p>
                {purchase.remaining > 0 ? (
                  allocatingId === purchase.id ? (
                    <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={(event) => submitAllocation(event, purchase.id)}>
                      <label>
                        <span className={labelClassName}>{t(locale, "admin.finance.partner")}</span>
                        <select className={inputClassName} name="partnerId" required defaultValue="">
                          <option value="">{t(locale, "admin.finance.partnerNone")}</option>
                          {partners.map((partner) => (
                            <option key={partner.id} value={partner.id}>
                              {partner.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className={labelClassName}>{t(locale, "admin.finance.amount")}</span>
                        <input className={inputClassName} name="amount" type="number" min="0.01" max={purchase.remaining} step="0.01" required />
                      </label>
                      <label>
                        <span className={labelClassName}>{t(locale, "admin.finance.date")}</span>
                        <input className={inputClassName} name="occurredOn" type="date" required />
                      </label>
                      <label>
                        <span className={labelClassName}>{t(locale, "admin.finance.description")}</span>
                        <input className={inputClassName} name="description" required maxLength={500} />
                      </label>
                      <div className="flex gap-2 sm:col-span-2">
                        <button type="submit" className="rounded-xl bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" disabled={busy}>
                          {t(locale, "admin.finance.save")}
                        </button>
                        <button type="button" className="text-sm text-slate-600" onClick={() => setAllocatingId(null)}>
                          {t(locale, "admin.finance.cancel")}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button type="button" className="mt-2 text-sm font-medium text-emerald-800 underline" onClick={() => setAllocatingId(purchase.id)}>
                      {t(locale, "admin.finance.allocate")}
                    </button>
                  )
                ) : null}
                {!purchase.imported ? (
                  <button type="button" className="mt-2 block text-sm text-slate-500 underline" disabled={busy} onClick={() => remove(routes.api.financeEntry(purchase.id))}>
                    {t(locale, "admin.finance.remove")}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t(locale, "admin.finance.allocationHistory")}
        </h3>
        {view.allocations.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">{t(locale, "admin.finance.empty")}</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {view.allocations.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <span className="text-slate-500">{row.occurredOn}</span> {row.partnerName} · {row.purchaseDescription}
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">{formatMoney(row.amount, locale)}</span>
                  {!row.imported ? (
                    <button type="button" className="text-slate-500 underline" disabled={busy} onClick={() => remove(routes.api.financeAllocation(row.id))}>
                      {t(locale, "admin.finance.remove")}
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t(locale, "admin.finance.activity")}>
        <p className="mb-3 text-sm text-slate-600">{t(locale, "admin.finance.activityHint")}</p>
        {view.activityRows.length === 0 ? (
          <p className="text-sm text-slate-500">{t(locale, "admin.finance.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">{t(locale, "admin.finance.colDate")}</th>
                  <th className="py-2 pr-3 font-medium">{t(locale, "admin.finance.colType")}</th>
                  <th className="py-2 pr-3 font-medium">{t(locale, "admin.finance.colDescription")}</th>
                  <th className="py-2 pr-3 font-medium">{t(locale, "admin.finance.colPartner")}</th>
                  <th className="py-2 pr-3 font-medium">{t(locale, "admin.finance.colCategory")}</th>
                  <th className="py-2 pr-3 font-medium">{t(locale, "admin.finance.colPayment")}</th>
                  <th className="py-2 pr-3 font-medium">{t(locale, "admin.finance.colAmount")}</th>
                  <th className="py-2 font-medium">{t(locale, "admin.finance.colSource")}</th>
                </tr>
              </thead>
              <tbody>
                {view.activityRows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="py-2 pr-3 whitespace-nowrap">{row.occurredOn}</td>
                    <td className="py-2 pr-3">{t(locale, KIND_KEYS[row.type])}</td>
                    <td className="py-2 pr-3">{row.description}</td>
                    <td className="py-2 pr-3">{row.partnerName ?? "—"}</td>
                    <td className="py-2 pr-3">{row.category ? t(locale, CATEGORY_KEYS[row.category]) : "—"}</td>
                    <td className="py-2 pr-3">{t(locale, PAYMENT_KEYS[row.paymentStatus])}</td>
                    <td className="py-2 pr-3 tabular-nums whitespace-nowrap">{formatMoney(row.amount, locale)}</td>
                    <td className="py-2">
                      {t(locale, SOURCE_KEYS[row.source])}
                      {row.source === "manual" && row.id.startsWith("entry:") ? (
                        <button
                          type="button"
                          className="ms-2 text-slate-500 underline"
                          disabled={busy}
                          onClick={() => remove(routes.api.financeEntry(row.id.slice("entry:".length)))}
                        >
                          {t(locale, "admin.finance.remove")}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </main>
  );
}

function Bar({
  label,
  value,
  max,
  locale,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  locale: Locale;
  tone: string;
}) {
  return (
    <div className="grid grid-cols-[5rem_1fr_auto] items-center gap-2 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="h-2 rounded-full bg-slate-100">
        <span className={`block h-2 rounded-full ${tone}`} style={{ width: `${Math.round((value / max) * 100)}%` }} />
      </span>
      <span className="tabular-nums text-slate-700">{formatMoney(value, locale)}</span>
    </div>
  );
}
