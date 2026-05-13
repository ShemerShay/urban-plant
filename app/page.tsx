import Link from "next/link";

export default function Home() {
  return (
    <main id="home-page" className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-8">
      <div className="flex flex-1 flex-col justify-center space-y-6">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
          Urban Plant
        </p>
        <h1 className="text-4xl font-semibold leading-tight text-emerald-950">
          QR-powered plant shopping for real spaces
        </h1>
        <p className="text-base leading-7 text-slate-600">
          Scan a plant in a partner location, learn everything you need in
          seconds, and complete your order in a calm mobile flow.
        </p>
      </div>

      <div className="space-y-3 pb-4">
        <Link
          href="/plant/olive-01?location=chachos-shenkin"
          className="block rounded-2xl bg-emerald-700 px-6 py-4 text-center text-sm font-semibold text-white"
        >
          Demo with QR location param
        </Link>
        <p className="text-center text-xs text-slate-500">
          Start with one mock product and expand later.
        </p>
      </div>
    </main>
  );
}
