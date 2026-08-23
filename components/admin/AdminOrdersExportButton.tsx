"use client";

import { useState } from "react";
import * as XLSX from "xlsx";

import { useLocale } from "@/components/locale/LocaleProvider";
import { formatOrderDeliveryAddressDisplay } from "@/lib/deliveryAddress";
import {
  fulfillmentLabel,
  orderStatusLabel,
  yesNoLabel,
} from "@/lib/displayLabels";
import type { Locale } from "@/lib/locale";
import { t } from "@/lib/messages";
import type { SavedOrder } from "@/lib/orderTypes";
import { isVerifiedPaidOrderStatus } from "@/lib/status";

interface AdminOrdersExportButtonProps {
  orders: SavedOrder[];
  menuItem?: boolean;
  onExport?: () => void;
}

function intlLocale(locale: Locale): string {
  return locale === "he" ? "he-IL" : "en-US";
}

function orderToRow(order: SavedOrder, locale: Locale): Record<string, string | number> {
  const productName = order.snapshot?.productName ?? order.plantName;
  const price = order.snapshot?.consumerPrice ?? order.price;
  const locationName = order.snapshot?.partnerLocationName ?? order.locationName;
  const paid = isVerifiedPaidOrderStatus(order.orderStatus);

  return {
    [t(locale, "admin.export.orderId")]: order.orderId,
    [t(locale, "admin.export.createdAt")]: new Date(order.createdAt).toLocaleString(
      intlLocale(locale),
    ),
    [t(locale, "admin.export.status")]: orderStatusLabel(locale, order.orderStatus),
    [t(locale, "admin.export.countedPaid")]: yesNoLabel(locale, paid),
    [t(locale, "admin.export.customerName")]: order.fullName,
    [t(locale, "admin.common.email")]: order.customerEmail ?? "",
    [t(locale, "admin.common.phone")]: order.phone,
    [t(locale, "admin.common.plant")]: productName,
    [t(locale, "admin.common.price")]: price,
    [t(locale, "admin.export.fulfillment")]: fulfillmentLabel(locale, order.fulfillmentMethod),
    [t(locale, "admin.common.location")]: locationName ?? "",
    [t(locale, "admin.export.deliveryAddress")]:
      order.fulfillmentMethod === "delivery"
        ? formatOrderDeliveryAddressDisplay(order, locale)
        : "",
    [t(locale, "admin.export.notes")]: order.apartmentOrNotes,
  };
}

export function AdminOrdersExportButton({
  orders,
  menuItem = false,
  onExport,
}: AdminOrdersExportButtonProps) {
  const locale = useLocale();
  const [busy, setBusy] = useState(false);

  function handleExport() {
    setBusy(true);
    try {
      const rows = orders.map((order) => orderToRow(order, locale));
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, t(locale, "admin.export.sheet"));
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
      {busy ? t(locale, "admin.export.exporting") : t(locale, "admin.export.button")}
    </button>
  );
}
