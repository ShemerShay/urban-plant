import { AdminFinanceDashboard } from "@/components/admin/AdminFinanceDashboard";
import { parseFinanceMonth } from "@/lib/finance/period";
import { loadFinanceView } from "@/lib/finance/storage";
import { isFinanceActivityFilter } from "@/lib/finance/types";
import { getLocale } from "@/lib/getLocale";
import { readPartners } from "@/lib/partnerStorage";

interface AdminFinancePageProps {
  searchParams: Promise<{
    month?: string | string[];
    activity?: string | string[];
  }>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

export default async function AdminFinancePage({ searchParams }: AdminFinancePageProps) {
  const sp = await searchParams;
  const month = parseFinanceMonth(firstParam(sp.month));
  const requestedActivity = firstParam(sp.activity);
  const activity = isFinanceActivityFilter(requestedActivity) ? requestedActivity : "all";
  const [view, partners, locale] = await Promise.all([
    loadFinanceView(month, activity),
    readPartners(),
    getLocale(),
  ]);
  return (
    <AdminFinanceDashboard
      view={view}
      partners={partners.map((partner) => ({ id: partner.id, name: partner.name }))}
      locale={locale}
    />
  );
}
