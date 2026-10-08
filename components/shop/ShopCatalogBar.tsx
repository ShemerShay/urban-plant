"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { ShopCart } from "@/components/shop/ShopCart";
import { catalogCartTotalQuantity } from "@/lib/catalogCart";
import { useCatalogCart } from "@/lib/catalogCartStore";
import { t } from "@/lib/messages";
import { routes } from "@/lib/routes";
import type { Locale } from "@/lib/locale";

const linkClass =
  "text-caption font-medium text-brand-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55";

export function ShopCatalogBar({
  locale,
  showBack = false,
}: {
  locale: Locale;
  showBack?: boolean;
}) {
  const cart = useCatalogCart();
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  const total = catalogCartTotalQuantity(cart);

  return (
    <div className={`mb-6 flex items-center gap-4 ${showBack ? "justify-between" : "justify-end"}`}>
      {showBack ? (
        <Link href={routes.shop.index()} className={linkClass}>
          {t(locale, "shop.back")}
        </Link>
      ) : null}
      <button
        type="button"
        aria-label={t(locale, "shop.cart")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={drawerId}
        onClick={() => setOpen(true)}
        className="relative flex size-11 items-center justify-center rounded-2xl text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55"
      >
        <svg
          className="size-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 7h15l-1.5 9h-12L5 4H2" />
          <circle cx="9" cy="20" r="1.2" />
          <circle cx="18" cy="20" r="1.2" />
        </svg>
        {total > 0 ? (
          <span className="absolute -end-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-semibold text-white">
            {total}
          </span>
        ) : null}
      </button>
      <ShopCart open={open} onClose={() => setOpen(false)} drawerId={drawerId} />
    </div>
  );
}
