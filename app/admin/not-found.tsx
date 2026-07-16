import Link from "next/link";

import { routes } from "@/lib/routes";

export default function AdminNotFound() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-4 py-10">
      <section className="rounded-3xl bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
          Urban Plant · Admin
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-emerald-950">Page not found</h1>
        <p className="mt-3 text-sm text-slate-600">
          This admin page doesn’t exist or the link is out of date.
        </p>
        <Link
          href={routes.admin.index()}
          className="mt-6 inline-block text-sm font-medium text-emerald-700 underline underline-offset-2"
        >
          Back to admin
        </Link>
      </section>
    </main>
  );
}
