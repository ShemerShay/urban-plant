import Link from "next/link";

import { getPlantById } from "@/lib/mockPlants";
import { readOrders } from "@/lib/ordersStorage";

interface SuccessPageProps {
  searchParams: Promise<{
    emailFailed?: string | string[];
    fulfillmentMethod?: string | string[];
    orderId?: string | string[];
    plantId?: string | string[];
    plantName?: string | string[];
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

export default async function SuccessPage({ searchParams }: SuccessPageProps) {
  const sp = await searchParams;
  const emailFailed = readEmailFailed(sp.emailFailed);
  const isPickup = readIsPickup(sp.fulfillmentMethod);
  const orderId = readOrderId(sp.orderId);
  const plantId = readPlantId(sp.plantId);
  const order = orderId ? (await readOrders()).find((o) => o.orderId === orderId) : undefined;
  const plantName =
    order?.plantName || getPlantById(plantId)?.name || readPlantName(sp.plantName) || "your plant";

  return (
    <main id="success-page" className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-10">
      <div className="flex-1 space-y-6">
        <section className="rounded-3xl bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
          <Link
            href="/"
            className="font-serif-display text-xl font-medium tracking-tight text-neutral-900 transition hover:opacity-70"
          >
            UrbanPlant
          </Link>
          <h1 className="mt-3 text-3xl font-semibold text-emerald-950">
            Thank you for your order
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {isPickup
              ? "Order received. Your plant is ready to leave with you."
              : "Your order was received successfully. Your plant will be delivered within 1-3 days, team member will contact with you"}
          </p>
          {emailFailed ? (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              We couldn’t send the confirmation email just now. Your order is still
              confirmed — Urban Plant will contact you soon with pickup or delivery details.
            </p>
          ) : null}
        </section>

        <section className="rounded-3xl bg-emerald-50 p-5">
          <p className="text-sm text-slate-600">Order summary</p>
          <p className="mt-1 text-base font-semibold text-emerald-900">
            1x {plantName} {isPickup ? "pickup" : "delivery"}
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
