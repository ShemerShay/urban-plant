import Link from "next/link";

import { routes } from "@/lib/routes";

/** Static admin pages (excludes dynamic segments such as partner detail). */
const ADMIN_PAGES = [
  {
    href: routes.admin.orders(),
    label: "Orders",
    description: "View and filter customer orders.",
  },
  {
    href: routes.admin.plants(),
    label: "Plants",
    description: "View and edit the product catalog (names, care, images, prices).",
  },
  {
    href: routes.admin.offers(),
    label: "Offers",
    description: "View and manage sale offers linked to catalog plants.",
  },
  {
    href: routes.admin.partners(),
    label: "Partners",
    description: "Manage partners, their pockets, and POS spots.",
  },
] as const;

export default function AdminIndexPage() {
  return (
    <main
      id="admin-index-page"
      className="mx-auto min-h-screen w-full max-w-md px-4 py-6 pb-12"
    >
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
          Urban Plant · Admin
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-emerald-950">Admin</h1>
      </div>

      <p className="mb-6 text-sm leading-relaxed text-slate-600">
        Choose a page to manage orders, plants, offers, and partners.
      </p>

      <ul className="space-y-3">
        {ADMIN_PAGES.map((page) => (
          <li key={page.href}>
            <Link
              href={page.href}
              className="block rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)] transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/45"
            >
              <span className="text-base font-semibold text-emerald-950">{page.label}</span>
              <span className="mt-1 block text-sm leading-relaxed text-slate-600">
                {page.description}
              </span>
              <span className="mt-2 block font-mono text-xs text-emerald-700">{page.href}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
