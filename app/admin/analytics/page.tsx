import { AdminAnalyticsDashboard } from "@/components/admin/AdminAnalyticsDashboard";
import { parseAnalyticsFilterState } from "@/lib/analytics/analyticsQuery";
import { loadBusinessAnalytics } from "@/lib/analytics/businessAnalytics";
import { getLocale } from "@/lib/getLocale";

interface AdminAnalyticsPageProps {
  searchParams: Promise<{
    inventoryType?: string | string[];
    date?: string | string[];
    from?: string | string[];
    to?: string | string[];
  }>;
}

function firstParam(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}

export default async function AdminAnalyticsPage({ searchParams }: AdminAnalyticsPageProps) {
  const sp = await searchParams;
  const locale = await getLocale();
  const filters = parseAnalyticsFilterState({
    inventoryType: firstParam(sp.inventoryType),
    date: firstParam(sp.date),
    from: firstParam(sp.from),
    to: firstParam(sp.to),
  });
  const data = await loadBusinessAnalytics(filters);
  return <AdminAnalyticsDashboard data={data} locale={locale} />;
}
