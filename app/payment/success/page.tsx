import Link from "next/link";

export default function PaymentSuccessPage() {
  return (
    <main
      id="payment-success-page"
      className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-10"
    >
      <div className="flex-1 space-y-6">
        <section className="rounded-3xl bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
          <Link
            href="/"
            className="font-serif-display text-xl font-medium tracking-tight text-neutral-900 transition hover:opacity-70"
          >
            UrbanPlant
          </Link>
          <h1 className="mt-3 text-3xl font-semibold text-emerald-950">Payment successful</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Your order was received successfully.
          </p>
        </section>
      </div>

      <Link
        href="/"
        className="mt-8 block rounded-2xl bg-emerald-700 px-5 py-4 text-center text-sm font-semibold text-white"
      >
        Return Home
      </Link>
    </main>
  );
}
