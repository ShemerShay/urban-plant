"use client";

import Link from "next/link";

import { routes } from "@/lib/routes";

export default function AdminError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-4 py-10">
      <section className="rounded-3xl bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
          Urban Plant · Admin
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-emerald-950">Something went wrong</h1>
        <p className="mt-3 text-sm text-slate-600">
          This admin page failed to load. Try again or return to the admin home.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white"
          >
            Try again
          </button>
          <Link
            href={routes.admin.index()}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-emerald-800"
          >
            Back to admin
          </Link>
        </div>
      </section>
    </main>
  );
}
