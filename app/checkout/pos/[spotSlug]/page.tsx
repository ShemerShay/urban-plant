import Link from "next/link";
import { notFound } from "next/navigation";

import { RememberCustomerPath } from "@/components/customer/RememberCustomerPath";
import { CheckoutForm } from "@/components/checkout/CheckoutForm";
import { formatPrice } from "@/lib/mockPlants";
import { getPlantById } from "@/lib/plantCatalog";
import { getOfferById } from "@/lib/offerStorage";
import { getLocationById } from "@/lib/mockLocations";
import { getPosSpotBySpotSlug } from "@/lib/posSpotStorage";
import { posSpotPath } from "@/lib/routes";

interface PosCheckoutPageProps {
  params: Promise<{ spotSlug: string }>;
}

export default async function PosCheckoutPage({ params }: PosCheckoutPageProps) {
  const { spotSlug } = await params;
  const posSpot = await getPosSpotBySpotSlug(spotSlug);
  if (!posSpot) notFound();

  const offer = await getOfferById(posSpot.currentOfferId);
  if (!offer || offer.status !== "active") notFound();

  const plant = await getPlantById(offer.productId);
  if (!plant) notFound();

  const partner = await getLocationById(posSpot.partnerLocationId);
  const pickupDisabled = Boolean(partner?.pickupDisabled);

  return (
    <main id="checkout-page" className="mx-auto min-h-screen w-full max-w-md px-4 py-6">
      <RememberCustomerPath />
      <div className="space-y-6">
        <Link href={posSpotPath(posSpot.spotSlug)} className="inline-block text-sm text-emerald-700">
          Back to plant
        </Link>

        <section className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
          <p className="text-sm text-slate-500">You are ordering</p>
          <h1 className="mt-1 text-2xl font-semibold text-emerald-950">{plant.name}</h1>
          <p className="mt-2 text-lg font-semibold text-emerald-950">
            {formatPrice(offer.consumerPrice, plant.currency)}
          </p>
        </section>

        <section className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
          <CheckoutForm
            plantId={plant.id}
            plantName={plant.name}
            priceDisplay={formatPrice(offer.consumerPrice, plant.currency)}
            spotSlug={posSpot.spotSlug}
            pickupDisabled={pickupDisabled}
            posSpotStatus={posSpot.status}
          />
        </section>
      </div>
    </main>
  );
}
