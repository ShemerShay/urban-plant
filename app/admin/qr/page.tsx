import Link from "next/link";

import { AdminQrGenerator } from "@/components/admin/AdminQrGenerator";

/**
 * Internal POS Spot QR tooling for pilot labeling. Replace with authenticated tooling + CMS before production.
 */
export default function AdminQrPage() {
  return (
    <main
      id="admin-qr-page"
      className="mx-auto min-h-screen w-full max-w-md px-4 py-6 pb-12"
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
            Urban Plant · Admin
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-emerald-950">Create POS Spot</h1>
        </div>
        <Link
          href="/"
          className="text-sm font-medium text-emerald-700 underline underline-offset-2"
        >
          Home
        </Link>
      </div>

      <section className="mb-8 rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
        <h2 className="text-base font-semibold text-emerald-950">How to use</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-600">
          <li>Select the Partner Location and existing Offer for this physical POS Spot.</li>
          <li>Enter the POS Spot description and stable Spot slug.</li>
          <li>Save the POS Spot, then copy the URL and/or download the QR as SVG.</li>
          <li>Print the QR and attach it to the correct physical display point.</li>
          <li>
            Double-check the print matches the right POS Spot before displaying it to
            customers.
          </li>
        </ol>
      </section>

      <AdminQrGenerator />
    </main>
  );
}
