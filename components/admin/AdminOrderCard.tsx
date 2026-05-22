"use client";

/**
 * Local JSON order management is only for prototype/testing and should be replaced
 * with a real database before production.
 */

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { AdminOrderStatusSelect } from "@/components/admin/AdminOrderStatusSelect";
import { formatPrice, getPlantById } from "@/lib/mockPlants";
import { formatOrderDeliveryAddressDisplay } from "@/lib/deliveryAddress";
import type { SavedOrder } from "@/lib/orderTypes";
import type { OrderStatus } from "@/lib/status";
import { ORDER_STATUS_LABELS } from "@/lib/status";

interface AdminOrderCardProps {
  order: SavedOrder;
}

function statusBadgeClass(status: OrderStatus): string {
  switch (status) {
    case "delivered":
      return "bg-emerald-100 text-emerald-900";
    case "picked_up":
      return "bg-amber-100 text-amber-950";
    case "cancelled":
      return "bg-red-50 text-red-700 ring-1 ring-red-100";
    default:
      return "bg-slate-100 text-slate-900";
  }
}

function IconCalendar({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M6.5 2.75v1.5M13.5 2.75v1.5M4.25 7.25h11.5M5.5 4.25h9c.69 0 1.25.56 1.25 1.25v10.5c0 .69-.56 1.25-1.25 1.25h-9a1.25 1.25 0 01-1.25-1.25V5.5c0-.69.56-1.25 1.25-1.25z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCancel({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M6 6l8 8M14 6l-8 8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMail({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M3.5 6.75l6.35 4.23a1.25 1.25 0 001.3 0L17.5 6.75M4.75 15.25h10.5c.69 0 1.25-.56 1.25-1.25V6c0-.69-.56-1.25-1.25-1.25H4.75A1.25 1.25 0 003.5 6v8c0 .69.56 1.25 1.25 1.25z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconPhone({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M6.25 3.5h2.1c.55 0 1.02.38 1.14.92l.45 2.02a1.25 1.25 0 01-.34 1.14l-1.1 1.1a11.5 11.5 0 005.53 5.53l1.1-1.1a1.25 1.25 0 011.14-.34l2.02.45c.54.12.92.59.92 1.14v2.1c0 .69-.56 1.25-1.25 1.25C9.2 17.25 2.75 10.8 2.75 3.75c0-.69.56-1.25 1.25-1.25z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconMapPin({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M10 10.75a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M10 17.25s5.5-4.44 5.5-8.25a5.5 5.5 0 10-11 0c0 3.81 5.5 8.25 5.5 8.25z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconLeaf({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M16.25 8.75C14.5 13.25 10.75 16 6.5 16c0-4.25 2.75-8 7.25-9.75 0 4.5-2.25 8.25-7.25 9.75z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconTag({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M4.5 10.75V5.5a1 1 0 011-1h5.25M11.25 3.5l5.25 5.25-6.36 6.36a1.5 1.5 0 01-2.12 0l-3.02-3.02a1.5 1.5 0 010-2.12L11.25 3.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8.25" cy="7.25" r="0.75" fill="currentColor" />
    </svg>
  );
}

function DetailRow({
  icon,
  children,
  className,
}: {
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex gap-3 text-sm leading-relaxed text-slate-800 ${className ?? ""}`}>
      <span className="mt-0.5 shrink-0 text-slate-400">{icon}</span>
      <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}

function SectionDivider() {
  return <div className="border-t border-slate-100" role="presentation" />;
}

export function AdminOrderCard({ order }: AdminOrderCardProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<"cancel" | "patch" | null>(null);

  const productId = order.snapshot?.productId ?? order.plantId;
  const plantName = order.snapshot?.productName ?? order.plantName;
  const price = order.snapshot?.consumerPrice ?? order.price;
  const currency = getPlantById(productId)?.currency ?? "ILS";
  const locationId = order.snapshot?.partnerLocationId ?? order.locationId;
  const locationName = order.snapshot?.partnerLocationName ?? order.locationName;
  const posSpotDescription = order.snapshot?.posSpotDescription;
  const spotSlug = order.snapshot?.spotSlug;
  const partnerAddress = order.locationAddress;

  async function handleCancel() {
    const cancellationReason = window.prompt("Cancellation reason");
    if (cancellationReason === null) return;
    const trimmedReason = cancellationReason.trim();
    if (!trimmedReason) {
      window.alert("Cancellation reason is required.");
      return;
    }
    setBusy("cancel");
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(order.orderId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancellationReason: trimmedReason }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        window.alert(data.error ?? "Could not cancel order.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function handleStatusChange(next: OrderStatus) {
    if (next === order.orderStatus) return;
    setBusy("patch");
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(order.orderId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderStatus: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        window.alert(data.error ?? "Could not update order.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const status = order.orderStatus;
  const createdLabel = new Date(order.createdAt).toLocaleString();
  const isCancelled = status === "cancelled";

  return (
    <li className="rounded-2xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
      {/* 1. Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm text-slate-600">
          <IconCalendar className="size-4 shrink-0 text-slate-400" />
          <time className="min-w-0 break-words font-medium" dateTime={order.createdAt}>
            {createdLabel}
          </time>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(status)}`}
        >
          {isCancelled ? <IconCancel className="size-3" /> : null}
          {ORDER_STATUS_LABELS[status]}
        </span>
      </div>

      <SectionDivider />

      {/* 2. Order status */}
      <section className="py-4">
        <label htmlFor={`order-status-${order.orderId}`} className="text-xs font-medium text-slate-500">
          Order status
        </label>
        <AdminOrderStatusSelect
          id={`order-status-${order.orderId}`}
          value={status}
          disabled={busy !== null}
          onChange={(next) => void handleStatusChange(next)}
        />
      </section>


      {/* 3. Customer details */}
      <section className="py-4">
        <h3 className="text-base font-semibold text-emerald-950">{order.fullName}</h3>
        <div className="mt-3 space-y-2.5">
          {order.customerEmail ? (
            <DetailRow icon={<IconMail className="size-4" />}>{order.customerEmail}</DetailRow>
          ) : null}
          <DetailRow icon={<IconPhone className="size-4" />}>{order.phone}</DetailRow>
          {order.fulfillmentMethod === "delivery" &&
          (order.address.trim() || order.apartmentOrNotes.trim()) ? (
            <DetailRow icon={<IconMapPin className="size-4" />}>
              {formatOrderDeliveryAddressDisplay(order)}
            </DetailRow>
          ) : null}
        </div>
      </section>

      <SectionDivider />

      {/* 4. Partner location */}
      <section className="py-4">
        <div className="flex items-center gap-2">
          <IconMapPin className="size-4 shrink-0 text-emerald-600" />
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-700">
            PARTNER LOCATION
          </h3>
        </div>
        <div className="mt-3 space-y-2 text-sm leading-relaxed text-slate-800">
          {locationId === null || locationId === undefined ? (
            <p className="text-slate-600">Not specified</p>
          ) : (
            <>
              <p className="font-medium text-emerald-950">{locationName ?? "Unknown location"}</p>
              {posSpotDescription ? (
                <p className="break-words [overflow-wrap:anywhere]">
                  <span className="text-slate-500">POS Spot: </span>
                  {posSpotDescription}
                </p>
              ) : null}
              <p className="break-words font-mono text-xs text-slate-600 [overflow-wrap:anywhere]">
                <span className="font-sans text-slate-500">Location ID: </span>
                {locationId}
              </p>
              {spotSlug ? (
                <p className="break-words font-mono text-xs text-slate-600 [overflow-wrap:anywhere]">
                  <span className="font-sans text-slate-500">Spot slug: </span>
                  {spotSlug}
                </p>
              ) : null}
              <div>
                <p className="break-words [overflow-wrap:anywhere]">
                  <span className="text-slate-500">Address: </span>
                  {partnerAddress ?? "—"}
                </p>
              </div>
            </>
          )}
        </div>
      </section>

      <SectionDivider />

      {/* 5. Plant and price */}
      <section className="space-y-2.5 py-4">
        <DetailRow icon={<IconLeaf className="size-4" />}>{plantName}</DetailRow>
        <DetailRow icon={<IconTag className="size-4" />}>{formatPrice(price, currency)}</DetailRow>
      </section>

      {/* 6. Footer */}
      <footer className="border-t border-slate-100 pt-4">
        {status === "delivered" && order.deliveredAt ? (
          <p className="text-xs leading-relaxed text-slate-500">
            Delivered: {new Date(order.deliveredAt).toLocaleString()}
          </p>
        ) : null}
        {status === "picked_up" && order.pickedUpAt ? (
          <p className="text-xs leading-relaxed text-slate-500">
            Sold &amp; Taken: {new Date(order.pickedUpAt).toLocaleString()}
          </p>
        ) : null}
        {isCancelled && order.cancelledAt ? (
          <p className="text-xs leading-relaxed text-slate-500">
            Cancelled: {new Date(order.cancelledAt).toLocaleString()}
            {order.cancellationReason ? ` — ${order.cancellationReason}` : ""}
          </p>
        ) : null}

        {!isCancelled ? (
          <div className={`${order.deliveredAt || order.pickedUpAt ? "mt-3" : ""}`}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void handleCancel()}
              className="w-full rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60 sm:w-auto"
            >
              {busy === "cancel" ? "Cancelling…" : "Cancel order"}
            </button>
          </div>
        ) : null}
      </footer>
    </li>
  );
}
