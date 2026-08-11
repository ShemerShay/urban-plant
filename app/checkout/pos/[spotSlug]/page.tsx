import Link from "next/link";
import { notFound } from "next/navigation";

import { TrackCheckoutStarted } from "@/components/analytics/TrackCheckoutStarted";
import { RememberCustomerPath } from "@/components/customer/RememberCustomerPath";
import { CheckoutForm } from "@/components/checkout/CheckoutForm";
import { formatPrice } from "@/lib/mockPlants";
import { getPlantById } from "@/lib/plantCatalog";
import { getOfferById } from "@/lib/offerStorage";
import { getLocationById } from "@/lib/mockLocations";
import { parseOrderIdQueryParam } from "@/lib/cardcomPaymentStatus";
import { getAwaitingPaymentAttemptForResume } from "@/lib/paymentAttemptStorage";
import { expireStalePaymentHold } from "@/lib/paymentHoldExpiry";
import { getPendingOrderForPaymentResume } from "@/lib/ordersStorage";
import { isPaymentResumeTokenShape } from "@/lib/paymentResumeToken";
import { getPocketById } from "@/lib/pocketStorage";
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
  const pocket = posSpot.pocketId ? await getPocketById(posSpot.pocketId) : undefined;
  const partnerName = partner?.name?.trim() || undefined;
  const analyticsContext = {
    pos_spot_id: posSpot.id,
    spot_slug: posSpot.spotSlug,
    plant_id: plant.id,
    plant_name: plant.name,
    offer_id: offer.id,
    partner_id: posSpot.partnerLocationId,
    partner_name: partnerName,
    pocket_id: posSpot.pocketId,
    pocket_name: pocket?.name,
    amount: offer.consumerPrice,
  };

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
    const attempt = await getAwaitingPaymentAttemptForResume(orderId, resumeToken);
    if (
      attempt &&
      attempt.posSpotId === posSpot.id &&
      (attempt.snapshot?.spotSlug === posSpot.spotSlug || !attempt.snapshot?.spotSlug)
    ) {
      paymentResume = {
        orderId: attempt.id,
        resumeToken,
        showPaymentFailedMessage: paymentFailedFlag,
        prefill: {
          fullName: attempt.fullName,
          email: attempt.customerEmail,
          phone: attempt.phone,
          fulfillmentMethod: attempt.fulfillmentMethod,
          ...(attempt.fulfillmentMethod === "delivery"
            ? {
                apartmentOrNotes: attempt.apartmentOrNotes,
              }
            : {}),
        },
      };
    } else {
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
                  apartmentOrNotes: pending.apartmentOrNotes,
                }
              : {}),
          },
        };
      }
    }
  }

  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-page="checkout-page"
      className="mx-auto min-h-screen w-full max-w-md px-4 py-6"
    >
      <TrackCheckoutStarted {...analyticsContext} />
      <RememberCustomerPath />
      <div className="space-y-6">
        <Link
          href={posSpotPath(posSpot.spotSlug)}
          className="inline-flex min-h-11 items-center text-sm font-medium text-emerald-800 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700/55 focus-visible:ring-offset-2"
        >
          Back to plant
        </Link>

        <section
          className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]"
          aria-labelledby="checkout-order-heading"
        >
          <p className="text-sm text-slate-600">You are ordering</p>
          <h1 id="checkout-order-heading" className="mt-1 text-2xl font-semibold text-emerald-950">
            {plant.name}
          </h1>
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
            analyticsContext={analyticsContext}
          />
        </section>
      </div>
    </main>
  );
}
