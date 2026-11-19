import { notFound, redirect } from "next/navigation";

import { AdminPartnerBrandHeader } from "@/components/admin/AdminPartnerBrands";
import { AdminPartnersManager } from "@/components/admin/AdminPartnersManager";
import { formatFinanceMoney } from "@/lib/finance/format";
import { loadPartnerFinanceSummary } from "@/lib/finance/storage";
import type { PartnerFinanceFigures } from "@/lib/finance/view";
import { getLocale } from "@/lib/getLocale";
import type { Locale } from "@/lib/locale";
import { t, type MessageKey } from "@/lib/messages";
import {
  getPartnerLocationById,
  readPartnerLocationsByPartnerId,
} from "@/lib/partnerLocationStorage";
import { getPartnerById } from "@/lib/partnerStorage";
import { readPosSpotsByPartnerLocationIds } from "@/lib/posSpotStorage";
import { routes } from "@/lib/routes";

interface PageProps {
  params: Promise<{ partnerId: string }>;
}

const SUMMARY_ROWS: { key: keyof PartnerFinanceFigures; label: MessageKey }[] = [
  { key: "totalInvested", label: "admin.finance.colTotalInvested" },
  { key: "orderRevenue", label: "admin.finance.orderRevenue" },
  { key: "expenses", label: "admin.finance.expenses" },
  { key: "allocated", label: "admin.finance.colAllocated" },
  { key: "result", label: "admin.finance.colResult" },
];

export default async function AdminPartnerPage({ params }: PageProps) {
  const { partnerId: rawId } = await params;
  const partnerId = decodeURIComponent(rawId);

  const partner = await getPartnerById(partnerId);
  if (!partner) {
    const location = await getPartnerLocationById(partnerId);
    if (location) redirect(routes.admin.partnerLocation(location.partnerId, location.id));
    notFound();
  }

  const [locale, summary, locations] = await Promise.all([
    getLocale(),
    loadPartnerFinanceSummary(partner.id),
    readPartnerLocationsByPartnerId(partner.id),
  ]);
  const posSpots = await readPosSpotsByPartnerLocationIds(
    locations.map((location) => location.id),
  );

  return (
    <main id="admin-partner-page" className="mx-auto min-h-screen w-full max-w-md px-4 py-6 pb-12">
      <AdminPartnerBrandHeader initialPartner={partner} />
      <PartnerFinanceSummary locale={locale} summary={summary} />
      <AdminPartnersManager
        partnerId={partner.id}
        initialPartners={locations}
        initialPosSpots={posSpots}
      />
    </main>
  );
}

function PartnerFinanceSummary({
  locale,
  summary,
}: {
  locale: Locale;
  summary: PartnerFinanceFigures;
}) {
  const rows = SUMMARY_ROWS.flatMap((row) => {
    if (row.key === "result" && summary.otherIncome !== 0) {
      return [
        { key: "otherIncome" as const, label: "admin.finance.otherIncome" as const },
        row,
      ];
    }
    return [row];
  });

  return (
    <section
      id="partner-finance-summary"
      data-partner-finance="summary"
      className="mb-6 rounded-3xl bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.04)]"
      aria-label={t(locale, "admin.finance.partnerSummary")}
    >
      <h2 className="text-sm font-semibold text-emerald-950">{t(locale, "admin.finance.partnerSummary")}</h2>
      <dl className="mt-3 space-y-2 text-sm">
        {rows.map((row) => (
          <div key={row.key} className="flex items-baseline justify-between gap-3">
            <dt className="text-slate-500">{t(locale, row.label)}</dt>
            <dd className="tabular-nums text-emerald-950">{formatFinanceMoney(summary[row.key], locale)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
