import Image from "next/image";

import { TrackPurchaseCompleted } from "@/components/analytics/TrackPurchaseCompleted";
import { CustomerRecoveryActions } from "@/components/customer/CustomerRecoveryActions";
import { RememberCustomerPath } from "@/components/customer/RememberCustomerPath";
import { isValidOrderIdUuid } from "@/lib/cardcomPaymentStatus";
import { getLocale } from "@/lib/getLocale";
import { t } from "@/lib/messages";
import { getPlantById } from "@/lib/plantCatalog";
import { inventoryTypeOrDefault } from "@/lib/inventoryType";
import { localizedPlantText } from "@/lib/plantDisplay";
import { getOrderById } from "@/lib/ordersStorage";
import { posSpotPath } from "@/lib/routes";
import { isVerifiedPaidOrderStatus } from "@/lib/status";

interface SuccessPageProps {
  searchParams: Promise<{
    emailFailed?: string | string[];
    fulfillmentMethod?: string | string[];
    orderId?: string | string[];
    plantId?: string | string[];
    plantName?: string | string[];
    spotSlug?: string | string[];
  }>;
}

function readEmailFailed(raw: string | string[] | undefined): boolean {
  const v = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  return v === "1" || v === "true";
}

function readIsPickup(raw: string | string[] | undefined): boolean {
  const v = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  return v === "pickup";
}

function readPlantName(raw: string | string[] | undefined): string {
  const v = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  return v?.trim() || "";
}

function readPlantId(raw: string | string[] | undefined): string {
  const v = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  return v?.trim() || "";
}

function readOrderId(raw: string | string[] | undefined): string {
  const v = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  return v?.trim() || "";
}

function readSpotSlug(raw: string | string[] | undefined): string {
  const v = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  return v?.trim() || "";
}

export default async function SuccessPage({ searchParams }: SuccessPageProps) {
  const locale = await getLocale();
  const sp = await searchParams;
  const emailFailed = readEmailFailed(sp.emailFailed);
  const orderId = readOrderId(sp.orderId);
  const plantId = readPlantId(sp.plantId);
  // Direct PK lookup — avoid loading all orders for one success page.
  // Invalid UUID must behave like a missing order (same as a failed find).
  const order =
    orderId && isValidOrderIdUuid(orderId)
      ? ((await getOrderById(orderId)) ?? undefined)
      : undefined;
  // Prefer trusted order fields; query params are fallback for legacy redirects only.
  const isPickup = order
    ? order.fulfillmentMethod === "pickup"
    : readIsPickup(sp.fulfillmentMethod);
  const plantFromOrderId = order?.plantId || order?.snapshot?.productId;
  const plant = (plantFromOrderId || plantId)
    ? await getPlantById(plantFromOrderId || plantId)
    : undefined;
  const livePlantName = plant
    ? localizedPlantText(locale, plant.name, plant.nameHe)
    : "";
  const isFlowerOrder = inventoryTypeOrDefault(plant?.inventoryType) === "flowers";
  const plantName = isFlowerOrder
    ? ""
    : livePlantName ||
      order?.snapshot?.productName ||
      order?.plantName ||
      (!order ? readPlantName(sp.plantName) : "") ||
      t(locale, "success.fallbackPlant");
  const spotSlug =
    order?.snapshot?.spotSlug?.trim() ||
    readSpotSlug(sp.spotSlug) ||
    "";
  const returnToPlantHref = spotSlug ? posSpotPath(spotSlug) : null;
  const plantImage = isFlowerOrder
    ? undefined
    : order?.snapshot?.productImage ?? plant?.images?.[0];

  const isPendingPayment = order?.orderStatus === "pending_payment";
  // With orderId: only verified paid statuses show final success. Without orderId: legacy thank-you.
  const showCompletedPurchase = order
    ? isVerifiedPaidOrderStatus(order.orderStatus)
    : !orderId;
  const trackVerifiedPurchase =
    order && isVerifiedPaidOrderStatus(order.orderStatus) ? order : undefined;

  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-page="success-page"
      className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-10"
    >
      {trackVerifiedPurchase ? (
        <TrackPurchaseCompleted
          order_id={trackVerifiedPurchase.orderId}
          pos_spot_id={trackVerifiedPurchase.posSpotId}
          spot_slug={
            trackVerifiedPurchase.snapshot?.spotSlug?.trim() || spotSlug || undefined
          }
          plant_id={
            trackVerifiedPurchase.plantId ||
            trackVerifiedPurchase.snapshot?.productId ||
            undefined
          }
          plant_name={
            isFlowerOrder
              ? undefined
              : trackVerifiedPurchase.snapshot?.productName ||
                trackVerifiedPurchase.plantName ||
                undefined
          }
          offer_id={
            trackVerifiedPurchase.offerId ||
            trackVerifiedPurchase.snapshot?.offerId ||
            undefined
          }
          partner_id={
            trackVerifiedPurchase.locationId ||
            trackVerifiedPurchase.snapshot?.partnerLocationId ||
            undefined
          }
          partner_name={
            trackVerifiedPurchase.locationName ||
            trackVerifiedPurchase.snapshot?.partnerLocationName ||
            undefined
          }
          amount={trackVerifiedPurchase.price}
          fulfillment_method={trackVerifiedPurchase.fulfillmentMethod}
        />
      ) : null}
      <RememberCustomerPath />
      <div className="flex-1 space-y-6">
        <section
          className="rounded-3xl bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.04)]"
          aria-labelledby="success-page-heading"
        >
          <p className="font-serif-display text-xl font-medium tracking-tight text-neutral-900">
            UrbanPlant
          </p>
          {isPendingPayment ? (
            <>
              <h1 id="success-page-heading" className="mt-3 text-3xl font-semibold text-emerald-950">
                {t(locale, "success.pending.title")}
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {t(locale, "success.pending.body")}
              </p>
            </>
          ) : showCompletedPurchase ? (
            <>
              <h1 id="success-page-heading" className="mt-3 text-3xl font-semibold text-emerald-950">
                {t(
                  locale,
                  isFlowerOrder ? "success.thanks.title.flowers" : "success.thanks.title",
                )}
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {isPickup
                  ? t(locale, "success.thanks.pickup")
                  : t(locale, "success.thanks.delivery")}
              </p>
              {emailFailed ? (
                <p
                  className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
                  role="alert"
                >
                  {t(locale, "success.emailFailed")}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <h1 id="success-page-heading" className="mt-3 text-3xl font-semibold text-emerald-950">
                {t(locale, "success.update.title")}
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {t(locale, "success.update.body")}
              </p>
            </>
          )}
        </section>

        <section
          className="rounded-3xl bg-emerald-50 p-5"
          aria-labelledby="order-summary-heading"
        >
          <h2 id="order-summary-heading" className="text-sm font-medium text-slate-700">
            {t(locale, "success.summary")}
          </h2>
          {plantImage ? (
            <div className="relative mt-3 aspect-[4/3] w-full overflow-hidden rounded-2xl bg-white">
              <Image
                src={plantImage}
                alt={t(locale, "success.photoAlt", { plantName })}
                fill
                className="object-cover"
                sizes="(max-width: 448px) 100vw, 448px"
              />
            </div>
          ) : null}
          <p className="mt-3 text-base font-semibold text-emerald-900">
            {isFlowerOrder
              ? t(locale, "success.line.flowers")
              : t(locale, isPickup ? "success.line.pickup" : "success.line.delivery", {
                  plantName,
                })}
          </p>
        </section>
      </div>

      <CustomerRecoveryActions
        preferredReturnHref={returnToPlantHref}
        returnLabel={t(
          locale,
          isFlowerOrder ? "success.returnPlant.flowers" : "success.returnPlant",
        )}
        whatsAppMessage={
          isFlowerOrder
            ? t(locale, "success.whatsapp.flowers")
            : t(locale, "success.whatsapp", { plantName })
        }
      />
    </main>
  );
}
