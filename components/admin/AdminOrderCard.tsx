"use client";

/**
 * Local JSON order management is only for prototype/testing and should be replaced
 * with a real database before production.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AdminOrderStatusSelect } from "@/components/admin/AdminOrderStatusSelect";
import { formatPrice, getPlantById } from "@/lib/mockPlants";
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
      return "bg-red-100 text-red-900";
    default:
      return "bg-slate-100 text-slate-900";
  }
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

  return (
    <li className="rounded-2xl bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {new Date(order.createdAt).toLocaleString()}
        </p>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(status)}`}
        >
          {ORDER_STATUS_LABELS[status]}
        </span>
      </div>

      <div className="mt-3">
        <label htmlFor={`order-status-${order.orderId}`} className="text-xs font-medium text-slate-500">
          Order status
        </label>
        <AdminOrderStatusSelect
          id={`order-status-${order.orderId}`}
          value={status}
          disabled={busy !== null}
          onChange={(next) => void handleStatusChange(next)}
        />
      </div>

      <p className="mt-3 text-base font-semibold text-emerald-950">{order.fullName}</p>
      {order.customerEmail ? (
        <p className="mt-1 text-sm text-slate-700">
          <span className="text-slate-500">Email: </span>
          {order.customerEmail}
        </p>
      ) : null}
      <p className="mt-1 text-sm text-slate-700">
        <span className="text-slate-500">Phone: </span>
        {order.phone}
      </p>
      <p className="mt-1 text-sm text-slate-700">
        <span className="text-slate-500">Address: </span>
        {order.address}
      </p>
      {order.apartmentOrNotes ? (
        <p className="mt-1 text-sm text-slate-700">
          <span className="text-slate-500">Notes: </span>
          {order.apartmentOrNotes}
        </p>
      ) : null}

      <div className="mt-3 rounded-xl bg-emerald-50/40 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
          Scan / partner location
        </p>
        {locationId === null || locationId === undefined ? (
          <p className="mt-1 text-sm text-slate-600">Not specified</p>
        ) : (
          <>
            <p className="mt-1 text-sm font-medium text-emerald-950">
              {locationName ?? "Unknown location"}
            </p>
            {posSpotDescription ? (
              <p className="mt-0.5 text-xs text-slate-600">
                <span className="text-slate-500">POS Spot: </span>
                {posSpotDescription}
              </p>
            ) : null}
            <p className="mt-0.5 text-xs text-slate-600">
              <span className="text-slate-500">Location ID: </span>
              {locationId}
            </p>
            {spotSlug ? (
              <p className="mt-0.5 text-xs text-slate-600">
                <span className="text-slate-500">Spot slug: </span>
                {spotSlug}
              </p>
            ) : null}
            <p className="mt-0.5 text-xs text-slate-600">
              <span className="text-slate-500">Address: </span>
              {order.locationAddress ?? "—"}
            </p>
          </>
        )}
      </div>

      <p className="mt-2 text-sm text-slate-700">
        <span className="text-slate-500">Plant: </span>
        {plantName}
      </p>
      <p className="mt-1 text-sm text-slate-700">
        <span className="text-slate-500">Price: </span>
        {formatPrice(price, currency)}
      </p>

      {status === "delivered" && order.deliveredAt ? (
        <p className="mt-2 text-xs text-slate-500">
          Delivered: {new Date(order.deliveredAt).toLocaleString()}
        </p>
      ) : null}
      {status === "picked_up" && order.pickedUpAt ? (
        <p className="mt-2 text-xs text-slate-500">
          Sold &amp; Taken: {new Date(order.pickedUpAt).toLocaleString()}
        </p>
      ) : null}
      {status === "cancelled" && order.cancelledAt ? (
        <p className="mt-2 text-xs text-slate-500">
          Cancelled: {new Date(order.cancelledAt).toLocaleString()}
          {order.cancellationReason ? ` - ${order.cancellationReason}` : ""}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void handleCancel()}
          className="rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60"
        >
          {busy === "cancel" ? "Cancelling…" : "Cancel order"}
        </button>
      </div>
    </li>
  );
}
