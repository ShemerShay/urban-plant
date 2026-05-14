import Link from "next/link";
import { notFound } from "next/navigation";

import { CheckoutForm } from "@/components/checkout/CheckoutForm";
import { formatPrice, getPlantById } from "@/lib/mockPlants";
import { plantPagePath } from "@/lib/qrNavigation";

interface CheckoutPageProps {
  params: Promise<{ plantId: string }>;
  searchParams: Promise<{ location?: string | string[] }>;
}

export default async function CheckoutPage({ params, searchParams }: CheckoutPageProps) {
  const { plantId } = await params;
  const plant = getPlantById(plantId);

  if (!plant) notFound();

  const sp = await searchParams;
  const rawLoc = sp.location;
  const locationQuery =
    typeof rawLoc === "string" ? rawLoc : Array.isArray(rawLoc) ? rawLoc[0] : undefined;
  const locationForLinks = locationQuery?.trim() || undefined;

  return (
    <main id="checkout-page" className="mx-auto min-h-screen w-full max-w-md px-4 py-6">
      <div className="space-y-6">
        <Link
          href={plantPagePath(plantId, locationForLinks)}
          className="inline-block text-sm text-emerald-700"
        >
          Back to plant
        </Link>

        <section className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
          <p className="text-sm text-slate-500">You are ordering</p>
          <h1 className="mt-1 text-2xl font-semibold text-emerald-950">{plant.name}</h1>
          <p className="mt-2 text-lg font-semibold text-emerald-950">
            {formatPrice(plant.price, plant.currency)}
          </p>
        </section>

        <section className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
          <CheckoutForm
            plantId={plantId}
            plantName={plant.name}
            plantStatus={plant.status}
            priceDisplay={formatPrice(plant.price, plant.currency)}
            locationId={locationForLinks ?? null}
          />
        </section>
      </div>
    </main>
  );
}
