"use client";

import Link from "next/link";

import { useLocale } from "@/components/locale/LocaleProvider";
import { t } from "@/lib/messages";
import { routes } from "@/lib/routes";

export default function AdminError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useLocale();
  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-4 py-10">
      <section className="rounded-3xl bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
          {t(locale, "admin.brand")}
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-emerald-950">
          {t(locale, "admin.error.title")}
        </h1>
        <p className="mt-3 text-sm text-slate-600">{t(locale, "admin.error.body")}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white"
          >
            {t(locale, "admin.error.retry")}
          </button>
          <Link
            href={routes.admin.index()}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-emerald-800"
          >
            {t(locale, "admin.error.back")}
          </Link>
        </div>
      </section>
    </main>
  );
}
