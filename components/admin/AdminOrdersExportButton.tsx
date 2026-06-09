"use client";

import { useState } from "react";
import * as XLSX from "xlsx";

import { formatOrderDeliveryAddressDisplay } from "@/lib/deliveryAddress";
import type { SavedOrder } from "@/lib/orderTypes";
import { ORDER_STATUS_LABELS } from "@/lib/status";

interface AdminOrdersExportButtonProps {
  orders: SavedOrder[];
  menuItem?: boolean;
  onExport?: () => void;
}

function orderToRow(order: SavedOrder): Record<string, string | number> {
  const productName = order.snapshot?.productName ?? order.plantName;
  const price = order.snapshot?.consumerPrice ?? order.price;
  const locationName = order.snapshot?.partnerLocationName ?? order.locationName;

  return {
    "Order ID": order.orderId,
    "Created At": new Date(order.createdAt).toLocaleString(),
    Status: ORDER_STATUS_LABELS[order.orderStatus],
    "Customer Name": order.fullName,
    Email: order.customerEmail ?? "",
    Phone: order.phone,
    Plant: productName,
    Price: price,
    Fulfillment: order.fulfillmentMethod,
    Location: locationName ?? "",
    "Delivery Address":
      order.fulfillmentMethod === "delivery" ? formatOrderDeliveryAddressDisplay(order) : "",
    "Apartment / Notes": order.apartmentOrNotes,
  };
}

export function AdminOrdersExportButton({
  orders,
  menuItem = false,
  onExport,
}: AdminOrdersExportButtonProps) {
  const [busy, setBusy] = useState(false);

  function handleExport() {
    setBusy(true);
    try {
      const rows = orders.map(orderToRow);
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Orders");
      XLSX.writeFile(workbook, "orders-export.xlsx");
      onExport?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      role={menuItem ? "menuitem" : undefined}
      disabled={busy || orders.length === 0}
      onClick={handleExport}
      className={
        menuItem
          ? "block w-full px-4 py-2.5 text-left text-sm font-semibold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          : "h-11 shrink-0 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 shadow-sm outline-none transition hover:bg-slate-50 focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60 disabled:cursor-not-allowed disabled:opacity-60"
      }
    >
      {busy ? "Exporting…" : "Export to Excel"}
    </button>
  );
}
