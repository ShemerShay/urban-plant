import { AdminAnalyticsDashboard } from "@/components/admin/AdminAnalyticsDashboard";
import { loadBusinessAnalytics } from "@/lib/analytics/businessAnalytics";
import { parseAnalyticsRange } from "@/lib/analytics/dateRange";

interface AdminAnalyticsPageProps {
  searchParams: Promise<{ range?: string | string[] }>;
}

function firstParam(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}

export default async function AdminAnalyticsPage({ searchParams }: AdminAnalyticsPageProps) {
  const sp = await searchParams;
  const range = parseAnalyticsRange(firstParam(sp.range));
  const data = await loadBusinessAnalytics(range);
  return <AdminAnalyticsDashboard data={data} />;
}
