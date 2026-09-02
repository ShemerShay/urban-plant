import { notFound } from "next/navigation";

import { TrackCheckoutStarted } from "@/components/analytics/TrackCheckoutStarted";
import { TrackPosScan } from "@/components/analytics/TrackPosScan";
import { RememberCustomerPath } from "@/components/customer/RememberCustomerPath";
import { CheckoutForm } from "@/components/checkout/CheckoutForm";
import { PlantImageGallery } from "@/components/plant/PlantImageGallery";
import { PlantPageHeader } from "@/components/plant/PlantPageHeader";
import { getLocale } from "@/lib/getLocale";
import { inventoryTypeOrDefault } from "@/lib/inventoryType";
import { t } from "@/lib/messages";
import { formatPrice } from "@/lib/mockPlants";
import { localizedPlantText } from "@/lib/plantDisplay";
import { parseOrderIdQueryParam } from "@/lib/cardcomPaymentStatus";
import { getAwaitingPaymentAttemptForResume } from "@/lib/paymentAttemptStorage";
import { getPendingOrderForPaymentResume } from "@/lib/ordersStorage";
import { isPaymentResumeTokenShape } from "@/lib/paymentResumeToken";
import { getPosLandingDetails } from "@/lib/posLandingRead";
import { getPosSpotForCustomerPurchase } from "@/lib/purchaseEligibility";

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
  const locale = await getLocale();
  const sp = await searchParams;
  const resolved = await getPosSpotForCustomerPurchase(spotSlug);
  if (!resolved) notFound();
  const { posSpot } = resolved;

  const { offer, plant, partner, pocket } = await getPosLandingDetails(posSpot);
  if (!offer || offer.status !== "active") notFound();
  if (!plant) notFound();

  const inventoryType = inventoryTypeOrDefault(plant.inventoryType);
  const isFlowerCheckout = inventoryType === "flowers";
  const pickupDisabled = Boolean(partner?.pickupDisabled);
  const partnerName = partner?.name?.trim() || undefined;
  const displayName = localizedPlantText(locale, plant.name, plant.nameHe);
  const priceDisplay = formatPrice(offer.consumerPrice, plant.currency, locale);
  const plantImages = plant.images ?? [];
  const analyticsContext = {
    pos_spot_id: posSpot.id,
    spot_slug: posSpot.spotSlug,
    plant_id: plant.id,
    inventory_type: inventoryType,
    ...(isFlowerCheckout ? {} : { plant_name: plant.name }),
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
          fulfillmentMethod: isFlowerCheckout ? "pickup" : attempt.fulfillmentMethod,
          ...(attempt.fulfillmentMethod === "delivery" && !isFlowerCheckout
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
            fulfillmentMethod: isFlowerCheckout ? "pickup" : pending.fulfillmentMethod,
            ...(pending.fulfillmentMethod === "delivery" && !isFlowerCheckout
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
      data-inventory-type={inventoryType}
      className="mx-auto min-h-screen w-full max-w-md px-4 py-6"
    >
      <TrackPosScan {...analyticsContext} />
      <TrackCheckoutStarted {...analyticsContext} />
      <RememberCustomerPath />
      <div className="space-y-6">
        <PlantPageHeader knownPartner={partner?.name ?? ""} />

        <div className={isFlowerCheckout ? "space-y-6" : "space-y-3"}>
          <section
            className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]"
            aria-labelledby="checkout-order-heading"
          >
            <p className="text-body text-slate-600">
              {t(
                locale,
                isFlowerCheckout ? "checkout.ordering.flowers" : "checkout.ordering",
              )}
            </p>
            {isFlowerCheckout ? (
              <h1
                id="checkout-order-heading"
                className="text-heading mt-1 font-semibold text-foreground"
              >
                {priceDisplay}
              </h1>
            ) : (
              <div className="mt-3 flex items-center gap-3">
                {plantImages.length > 0 ? (
                  <div className="w-32 shrink-0 sm:w-36">
                    <PlantImageGallery compact images={plantImages} name={displayName} />
                  </div>
                ) : null}
                <div className="min-w-0 flex-1">
                  <h1
                    id="checkout-order-heading"
                    className="text-heading-sm font-semibold text-foreground sm:text-heading"
                  >
                    {t(locale, "checkout.plant.withPot", { name: displayName })}
                  </h1>
                  <p className="text-heading-sm mt-1 font-semibold text-foreground">{priceDisplay}</p>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
            <CheckoutForm
              plantId={plant.id}
              plantName={displayName}
              priceDisplay={priceDisplay}
              spotSlug={posSpot.spotSlug}
              inventoryType={inventoryType}
              pickupDisabled={pickupDisabled}
              posSpotStatus={posSpot.status}
              paymentResume={paymentResume}
              analyticsContext={analyticsContext}
            />
          </section>
        </div>
      </div>
    </main>
  );
}
