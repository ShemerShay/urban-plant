import Link from "next/link";

import { getLocale } from "@/lib/getLocale";
import { t } from "@/lib/messages";
import { routes } from "@/lib/routes";

/** Static admin pages (excludes dynamic segments such as partner detail). */
const ADMIN_PAGE_KEYS = [
  {
    href: routes.admin.analytics(),
    label: "admin.home.analytics",
    description: "admin.home.analyticsDesc",
  },
  {
    href: routes.admin.orders(),
    label: "admin.home.orders",
    description: "admin.home.ordersDesc",
  },
  {
    href: routes.admin.plants(),
    label: "admin.home.plants",
    description: "admin.home.plantsDesc",
  },
  {
    href: routes.admin.offers(),
    label: "admin.home.offers",
    description: "admin.home.offersDesc",
  },
  {
    href: routes.admin.partners(),
    label: "admin.home.partners",
    description: "admin.home.partnersDesc",
  },
] as const;

export default async function AdminIndexPage() {
  const locale = await getLocale();
  return (
    <main
      id="admin-index-page"
      className="mx-auto min-h-screen w-full max-w-md px-4 py-6 pb-12"
    >
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
          {t(locale, "admin.brand")}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-emerald-950">
          {t(locale, "admin.home.title")}
        </h1>
      </div>

      <p className="mb-6 text-sm leading-relaxed text-slate-600">
        {t(locale, "admin.home.intro")}
      </p>

      <ul className="space-y-3">
        {ADMIN_PAGE_KEYS.map((page) => (
          <li key={page.href}>
            <Link
              href={page.href}
              className="block rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)] transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/45"
            >
              <span className="text-base font-semibold text-emerald-950">
                {t(locale, page.label)}
              </span>
              <span className="mt-1 block text-sm leading-relaxed text-slate-600">
                {t(locale, page.description)}
              </span>
              <span className="mt-2 block font-mono text-xs text-emerald-700">{page.href}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
