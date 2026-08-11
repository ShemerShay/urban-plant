import Image from "next/image";

import { CustomerRecoveryActions } from "@/components/customer/CustomerRecoveryActions";
import { RememberCustomerPath } from "@/components/customer/RememberCustomerPath";
import { isValidOrderIdUuid } from "@/lib/cardcomPaymentStatus";
import { getPlantById } from "@/lib/plantCatalog";
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
  const plantName =
    order?.snapshot?.productName ||
    order?.plantName ||
    plant?.name ||
    (!order ? readPlantName(sp.plantName) : "") ||
    "your plant";
  const spotSlug =
    order?.snapshot?.spotSlug?.trim() ||
    readSpotSlug(sp.spotSlug) ||
    "";
  const returnToPlantHref = spotSlug ? posSpotPath(spotSlug) : null;
  const plantImage = order?.snapshot?.productImage ?? plant?.images[0];

  const isPendingPayment = order?.orderStatus === "pending_payment";
  // With orderId: only verified paid statuses show final success. Without orderId: legacy thank-you.
  const showCompletedPurchase = order
    ? isVerifiedPaidOrderStatus(order.orderStatus)
    : !orderId;

  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-page="success-page"
      className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-10"
    >
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
                Payment still in progress
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                We have your order details, but payment has not been confirmed yet. This page does
                not complete a purchase.
              </p>
            </>
          ) : showCompletedPurchase ? (
            <>
              <h1 id="success-page-heading" className="mt-3 text-3xl font-semibold text-emerald-950">
                Thank you for your order
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {isPickup
                  ? "Order received. Your plant is ready to leave with you."
                  : "Your order was received successfully. Your plant will be delivered within 1-3 days, team member will contact with you"}
              </p>
              {emailFailed ? (
                <p
                  className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
                  role="alert"
                >
                  We couldn’t send the confirmation email just now. Your order is still
                  confirmed — Urban Plant will contact you soon with pickup or delivery details.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <h1 id="success-page-heading" className="mt-3 text-3xl font-semibold text-emerald-950">
                Order update
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                This order is not a completed purchase. If you need help, message Urban Plant on
                WhatsApp.
              </p>
            </>
          )}
        </section>

        <section
          className="rounded-3xl bg-emerald-50 p-5"
          aria-labelledby="order-summary-heading"
        >
          <h2 id="order-summary-heading" className="text-sm font-medium text-slate-700">
            Order summary
          </h2>
          {plantImage ? (
            <div className="relative mt-3 aspect-[4/3] w-full overflow-hidden rounded-2xl bg-white">
              <Image
                src={plantImage}
                alt={`Photo of ${plantName}`}
                fill
                className="object-cover"
                sizes="(max-width: 448px) 100vw, 448px"
              />
            </div>
          ) : null}
          <p className="mt-3 text-base font-semibold text-emerald-900">
            1x {plantName} {isPickup ? "pickup" : "delivery"}
          </p>
        </section>
      </div>

      <CustomerRecoveryActions
        preferredReturnHref={returnToPlantHref}
        returnLabel="Return to plant"
        whatsAppMessage={`Hi Urban Plant — I have a question about my order for “${plantName}”.`}
      />
    </main>
  );
}
