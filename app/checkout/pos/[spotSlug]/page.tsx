import Link from "next/link";
import { notFound } from "next/navigation";

import { RememberCustomerPath } from "@/components/customer/RememberCustomerPath";
import { CheckoutForm } from "@/components/checkout/CheckoutForm";
import { formatPrice } from "@/lib/mockPlants";
import { getPlantById } from "@/lib/plantCatalog";
import { getOfferById } from "@/lib/offerStorage";
import { getLocationById } from "@/lib/mockLocations";
import { parseOrderIdQueryParam } from "@/lib/cardcomPaymentStatus";
import { expireStalePaymentHold } from "@/lib/paymentHoldExpiry";
import { getPendingOrderForPaymentResume } from "@/lib/ordersStorage";
import { isPaymentResumeTokenShape } from "@/lib/paymentResumeToken";
import { getPosSpotBySpotSlug } from "@/lib/posSpotStorage";
import { posSpotPath } from "@/lib/routes";

interface PosCheckoutPageProps {
  params: Promise<{ spotSlug: string }>;
  searchParams: Promise<{
    paymentFailed?: string | string[];
    orderId?: string | string[];
    resume?: string | string[];
  }>;
}

function readParam(raw: string | string[] | undefined): string | null {
  const v = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  return v?.trim() || null;
}

export default async function PosCheckoutPage({
  params,
  searchParams,
}: PosCheckoutPageProps) {
  const { spotSlug } = await params;
  const sp = await searchParams;
  let posSpot = await getPosSpotBySpotSlug(spotSlug);
  if (!posSpot) notFound();

  await expireStalePaymentHold(posSpot.id);
  posSpot = (await getPosSpotBySpotSlug(spotSlug)) ?? posSpot;

  const offer = await getOfferById(posSpot.currentOfferId);
  if (!offer || offer.status !== "active") notFound();

  const plant = await getPlantById(offer.productId);
  if (!plant) notFound();

  const partner = await getLocationById(posSpot.partnerLocationId);
  const pickupDisabled = Boolean(partner?.pickupDisabled);

  const orderId = parseOrderIdQueryParam(readParam(sp.orderId));
  const resumeToken = readParam(sp.resume);
  const paymentFailedFlag =
    readParam(sp.paymentFailed) === "1" || readParam(sp.paymentFailed) === "true";

  let paymentResume:
    | {
        orderId: string;
        resumeToken: string;
        showPaymentFailedMessage: boolean;
        prefill: {
          fullName: string;
          email: string;
          phone: string;
          fulfillmentMethod: "delivery" | "pickup";
          deliveryStreet?: string;
          deliveryHouseNumber?: string;
          apartmentOrNotes?: string;
        };
      }
    | undefined;

  if (orderId && isPaymentResumeTokenShape(resumeToken)) {
    const pending = await getPendingOrderForPaymentResume(orderId, resumeToken);
    if (
      pending &&
      pending.posSpotId === posSpot.id &&
      (pending.snapshot?.spotSlug === posSpot.spotSlug || !pending.snapshot?.spotSlug)
    ) {
      paymentResume = {
        orderId: pending.orderId,
        resumeToken,
        showPaymentFailedMessage: paymentFailedFlag,
        prefill: {
          fullName: pending.fullName,
          email: pending.customerEmail ?? "",
          phone: pending.phone,
          fulfillmentMethod: pending.fulfillmentMethod,
          ...(pending.fulfillmentMethod === "delivery"
            ? {
                // Address is stored combined; leave street fields for customer to confirm.
                apartmentOrNotes: pending.apartmentOrNotes,
              }
            : {}),
        },
      };
    }
  }

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
            paymentResume={paymentResume}
          />
        </section>
      </div>
    </main>
  );
}
