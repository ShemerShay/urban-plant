import { getLocale } from "@/lib/getLocale";
import { t } from "@/lib/messages";

export default async function AdminAnalyticsLoading() {
  const locale = await getLocale();
  return (
    <main
      id="admin-analytics-loading"
      className="mx-auto min-h-screen w-full max-w-3xl px-4 py-6 pb-24"
      aria-busy="true"
    >
      <p className="sr-only">{t(locale, "admin.common.loading")}</p>
      <div className="h-8 w-40 animate-pulse rounded-lg bg-slate-200" />
      <div className="mt-4 h-8 w-56 animate-pulse rounded-lg bg-slate-200" />
      <div className="mt-8 flex gap-3">
        <div className="h-11 min-w-40 flex-1 animate-pulse rounded-xl bg-slate-200" />
        <div className="h-11 min-w-40 flex-1 animate-pulse rounded-xl bg-slate-200" />
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-3xl bg-white shadow-[0_8px_30px_rgba(15,23,42,0.04)]"
          />
        ))}
      </div>
      <div className="mt-6 h-48 animate-pulse rounded-3xl bg-white shadow-[0_8px_30px_rgba(15,23,42,0.04)]" />
    </main>
  );
}
