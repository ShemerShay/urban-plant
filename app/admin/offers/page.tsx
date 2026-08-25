import Link from "next/link";

import { getLocale } from "@/lib/getLocale";
import { t } from "@/lib/messages";
import { routes } from "@/lib/routes";

const OFFER_SECTIONS = [
  {
    href: routes.admin.offersPlants(),
    label: "admin.inventoryTypes.plants",
    description: "admin.offers.plantsDesc",
  },
  {
    href: routes.admin.offersFlowers(),
    label: "admin.inventoryTypes.flowers",
    description: "admin.offers.flowersDesc",
  },
] as const;

export default async function AdminOffersHubPage() {
  const locale = await getLocale();
  return (
    <main
      id="admin-offers-page"
      className="mx-auto min-h-screen w-full max-w-md px-4 py-6 pb-12"
    >
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
          {t(locale, "admin.brand")}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-emerald-950">
          {t(locale, "admin.offers.title")}
        </h1>
      </div>

      <p className="mb-6 text-sm leading-relaxed text-slate-600">
        {t(locale, "admin.offers.hubIntro")}
      </p>

      <ul className="space-y-3">
        {OFFER_SECTIONS.map((section) => (
          <li key={section.href}>
            <Link
              href={section.href}
              className="block rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)] transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/45"
            >
              <span className="text-base font-semibold text-emerald-950">
                {t(locale, section.label)}
              </span>
              <span className="mt-1 block text-sm leading-relaxed text-slate-600">
                {t(locale, section.description)}
              </span>
              <span className="mt-2 block font-mono text-xs text-emerald-700">
                {section.href}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-6">
        <Link
          href={routes.admin.index()}
          className="text-sm font-medium text-emerald-700 underline underline-offset-2"
        >
          {t(locale, "admin.common.admin")}
        </Link>
      </p>
    </main>
  );
}
