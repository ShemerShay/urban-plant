import Link from "next/link";

import { AdminPosSpotList } from "@/components/admin/AdminPosSpotList";

/**
 * Admin index of all POS Spots with live QR codes for copy, open, and download.
 */
export default function AdminPosSpotsPage() {
  return (
    <main
      id="admin-pos-spots-page"
      className="mx-auto min-h-screen w-full max-w-md px-4 py-6 pb-12"
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
            Urban Plant · Admin
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-emerald-950">POS Spots</h1>
        </div>
        <Link
          href="/"
          className="text-sm font-medium text-emerald-700 underline underline-offset-2"
        >
          Home
        </Link>
      </div>

      <p className="mb-6 text-sm leading-relaxed text-slate-600">
        Every POS Spot and its QR for scanning at{" "}
        <span className="font-mono text-slate-800">/pos/{"{spotSlug}"}</span>.
      </p>

      <AdminPosSpotList />

      <p className="mt-8 text-center text-xs text-slate-500">
        <Link
          href="/admin/qr"
          className="font-medium text-emerald-700 underline underline-offset-2"
        >
          Create POS Spot
        </Link>
        {" · "}
        <Link
          href="/admin/orders"
          className="font-medium text-emerald-700 underline underline-offset-2"
        >
          Back to orders
        </Link>
      </p>
    </main>
  );
}
