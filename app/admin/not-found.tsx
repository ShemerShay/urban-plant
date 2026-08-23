import Link from "next/link";

import { getLocale } from "@/lib/getLocale";
import { t } from "@/lib/messages";
import { routes } from "@/lib/routes";

export default async function AdminNotFound() {
  const locale = await getLocale();
  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-4 py-10">
      <section className="rounded-3xl bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
          {t(locale, "admin.brand")}
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-emerald-950">
          {t(locale, "admin.notFound.title")}
        </h1>
        <p className="mt-3 text-sm text-slate-600">{t(locale, "admin.notFound.body")}</p>
        <Link
          href={routes.admin.index()}
          className="mt-6 inline-block text-sm font-medium text-emerald-700 underline underline-offset-2"
        >
          {t(locale, "admin.error.back")}
        </Link>
      </section>
    </main>
  );
}
