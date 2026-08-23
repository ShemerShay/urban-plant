/**
 * Local JSON order management is only for prototype/testing and should be replaced
 * with a real database before production.
 */

import Link from "next/link";

import { AdminNewOrderForm } from "@/components/admin/AdminNewOrderForm";
import { getLocale } from "@/lib/getLocale";
import { t } from "@/lib/messages";
import { routes } from "@/lib/routes";

export default async function AdminNewOrderPage() {
  const locale = await getLocale();
  return (
    <main
      id="admin-new-order-page"
      className="mx-auto min-h-screen w-full max-w-md px-4 py-6 pb-10"
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-emerald-950">
          {t(locale, "admin.orders.new")}
        </h1>
        <Link
          href={routes.admin.orders()}
          className="text-sm font-medium text-emerald-700 underline underline-offset-2"
        >
          {t(locale, "admin.orders.back")}
        </Link>
      </div>

      <section className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
        <AdminNewOrderForm />
      </section>
    </main>
  );
}
