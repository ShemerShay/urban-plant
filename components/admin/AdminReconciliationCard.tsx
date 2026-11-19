"use client";

import { AdminCatalogOrderLines } from "@/components/admin/AdminCatalogOrderLines";
import { useLocale } from "@/components/locale/LocaleProvider";
import type { AdminReconciliationAttemptView } from "@/lib/adminOrderDisplay";
import { formatCatalogPrice } from "@/lib/catalogPriceFormat";
import { formatOrderDeliveryAddressDisplay } from "@/lib/deliveryAddress";
import type { Locale } from "@/lib/locale";
import { t } from "@/lib/messages";

interface AdminReconciliationCardProps {
  attempt: AdminReconciliationAttemptView;
}

function intlLocale(locale: Locale): string {
  return locale === "he" ? "he-IL" : "en-US";
}

export function AdminReconciliationCard({ attempt }: AdminReconciliationCardProps) {
  const locale = useLocale();
  const createdLabel = new Date(attempt.createdAt).toLocaleString(intlLocale(locale));
  const email = attempt.customerEmail.trim();
  const phone = attempt.phone.trim();

  return (
    <li className="rounded-2xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)] ring-1 ring-amber-200">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-800">
            {t(locale, "admin.orders.channelCatalog")}
          </p>
          <p className="mt-1 font-mono text-xs text-slate-600 [overflow-wrap:anywhere]">
            <span className="font-sans text-slate-500">{t(locale, "admin.orders.attemptId")} </span>
            {attempt.id}
          </p>
          <time className="mt-1 block text-sm font-medium text-slate-600" dateTime={attempt.createdAt}>
            {createdLabel}
          </time>
        </div>
        <span className="inline-flex shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-950 ring-1 ring-amber-200">
          {t(locale, "admin.orders.needsReview")}
        </span>
      </div>

      <div className="mt-4 space-y-1.5 text-sm text-slate-800">
        <h3 className="text-base font-semibold text-emerald-950">
          {attempt.fullName.trim() || t(locale, "admin.common.notSpecified")}
        </h3>
        {email ? <p className="break-words [overflow-wrap:anywhere]">{email}</p> : null}
        {phone ? <p>{phone}</p> : null}
        <p className="break-words [overflow-wrap:anywhere]">
          {formatOrderDeliveryAddressDisplay(
            { address: attempt.address, apartmentOrNotes: attempt.apartmentOrNotes },
            "en",
          )}
        </p>
      </div>

      <dl className="mt-4 space-y-1.5 text-sm text-slate-800">
        <div>
          <dt className="text-xs font-medium text-slate-500">{t(locale, "admin.orders.amount")}</dt>
          <dd className="font-semibold text-emerald-950">
            {formatCatalogPrice(attempt.amount, attempt.currency, locale)}
          </dd>
        </div>
        {attempt.failureReason ? (
          <div>
            <dt className="text-xs font-medium text-slate-500">
              {t(locale, "admin.orders.failureReason")}
            </dt>
            <dd className="font-mono text-xs [overflow-wrap:anywhere]">{attempt.failureReason}</dd>
          </div>
        ) : null}
        {attempt.cardcomTransactionId != null ? (
          <div>
            <dt className="text-xs font-medium text-slate-500">
              {t(locale, "admin.orders.cardcomTransaction")}
            </dt>
            <dd className="font-mono text-xs">{attempt.cardcomTransactionId}</dd>
          </div>
        ) : null}
        {attempt.cardcomEnv ? (
          <div>
            <dt className="text-xs font-medium text-slate-500">
              {t(locale, "admin.orders.cardcomEnv")}
            </dt>
            <dd>{attempt.cardcomEnv}</dd>
          </div>
        ) : null}
        {attempt.checkoutSessionId ? (
          <div>
            <dt className="text-xs font-medium text-slate-500">
              {t(locale, "admin.orders.checkoutSession")}
            </dt>
            <dd className="font-mono text-xs [overflow-wrap:anywhere]">{attempt.checkoutSessionId}</dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-4 border-t border-slate-100 pt-4">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-700">
          {t(locale, "admin.orders.purchasedLines")}
        </h4>
        <AdminCatalogOrderLines lines={attempt.lines} />
      </div>
    </li>
  );
}
