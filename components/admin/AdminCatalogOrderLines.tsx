"use client";

import {
  catalogStoredPlantName,
  catalogStoredPotLabel,
  type AdminCatalogLineView,
} from "@/lib/adminOrderDisplay";
import { formatCatalogPrice } from "@/lib/catalogPriceFormat";
import { useLocale } from "@/components/locale/LocaleProvider";
import { t } from "@/lib/messages";

interface AdminCatalogOrderLinesProps {
  lines: AdminCatalogLineView[];
  total?: number;
}

export function AdminCatalogOrderLines({ lines, total }: AdminCatalogOrderLinesProps) {
  const locale = useLocale();
  const currency = lines[0]?.currency ?? "ILS";

  if (lines.length === 0) {
    return (
      <p className="text-sm text-slate-600">{t(locale, "admin.orders.noCatalogItems")}</p>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {lines.map((line) => {
          const potLabel = catalogStoredPotLabel(line);
          return (
            <li
              key={`${line.lineNo}-${line.plantId}`}
              className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-800"
            >
              <p className="font-medium text-emerald-950">
                {catalogStoredPlantName(line, locale)}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
                {line.sizeLabel ? (
                  <>
                    <dt>{t(locale, "admin.orders.size")}</dt>
                    <dd className="text-slate-800">{line.sizeLabel}</dd>
                  </>
                ) : null}
                {potLabel ? (
                  <>
                    <dt>{t(locale, "admin.orders.pot")}</dt>
                    <dd className="text-slate-800">{potLabel}</dd>
                  </>
                ) : null}
                <dt>{t(locale, "admin.orders.quantity")}</dt>
                <dd className="text-slate-800">{line.quantity}</dd>
                <dt>{t(locale, "admin.orders.unitPrice")}</dt>
                <dd className="text-slate-800">
                  {formatCatalogPrice(line.unitPrice, line.currency, locale)}
                </dd>
                <dt>{t(locale, "admin.orders.lineTotal")}</dt>
                <dd className="font-medium text-slate-900">
                  {formatCatalogPrice(line.lineTotal, line.currency, locale)}
                </dd>
              </dl>
            </li>
          );
        })}
      </ul>
      {total != null ? (
        <p className="text-sm font-semibold text-emerald-950">
          {t(locale, "admin.orders.orderTotal")}: {formatCatalogPrice(total, currency, locale)}
        </p>
      ) : null}
    </div>
  );
}
