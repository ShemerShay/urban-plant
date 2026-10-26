"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { usePostHog } from "posthog-js/react";

import { useLocale } from "@/components/locale/LocaleProvider";
import { formatCatalogPrice } from "@/lib/catalogPriceFormat";
import {
  ANALYTICS_EVENTS,
  captureAnalyticsEvent,
} from "@/lib/analyticsEvents";
import {
  catalogCartItemKey,
  catalogCartItemsEqual,
  catalogCartLineAmount,
  removeCatalogCartItem,
  storedCatalogCartItems,
  updateCatalogCartQuantity,
  type CatalogCartResolvedLine,
} from "@/lib/catalogCart";
import { useCatalogCart, writeCatalogCart } from "@/lib/catalogCartStore";
import { localizedPlantText } from "@/lib/plantDisplay";
import { t } from "@/lib/messages";
import { routes } from "@/lib/routes";
import { ShopSoftSpinner } from "@/components/shop/ShopSoftSpinner";

const qtyButtonClass =
  "text-body flex h-10 w-10 items-center justify-center rounded-2xl bg-neutral-100 font-medium text-foreground transition hover:bg-neutral-200/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:text-neutral-400 disabled:hover:bg-neutral-100";

function ShopCartEmpty({ label }: { label: string }) {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 text-center">
      <svg
        className="size-16 text-brand-muted"
        viewBox="0 0 64 64"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M32 34V16" />
        <path d="M32 24c-6.5-1.5-10-7.5-8-12 6 1 9 7 8 12" />
        <path d="M32 22c6.5-2 10-7.5 8-12-6 2-9 7-8 12" />
        <path d="M14 28h36l-3.2 16H19.5L16 16h-6" />
        <circle cx="25" cy="50" r="2.25" />
        <circle cx="41" cy="50" r="2.25" />
      </svg>
      <p className="text-body text-neutral-600">{label}</p>
    </div>
  );
}

function sizeLabel(line: CatalogCartResolvedLine): string {
  const label = line.sizeLabel?.trim();
  if (label) return label;
  if (line.nurseryPotDiameterCm != null) return String(line.nurseryPotDiameterCm);
  return "";
}

export function ShopCart({
  open,
  onClose,
  drawerId,
}: {
  open: boolean;
  onClose: () => void;
  drawerId: string;
}) {
  const locale = useLocale();
  const posthog = usePostHog();
  const cart = useCatalogCart();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [lines, setLines] = useState<CatalogCartResolvedLine[]>([]);
  const resolvedKeyRef = useRef("");
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const requestKey = JSON.stringify(cart.items);
    if (cart.items.length === 0) {
      resolvedKeyRef.current = "[]";
      setLines([]);
      setLoading(false);
      setError(false);
      return;
    }
    if (requestKey === resolvedKeyRef.current) return;

    let cancelled = false;
    setLoading(true);
    setError(false);

    void (async () => {
      try {
        const response = await fetch(routes.api.shopCartResolve(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cart),
        });
        if (!response.ok) throw new Error("resolve failed");
        const payload = (await response.json()) as { items?: CatalogCartResolvedLine[] };
        const nextLines = Array.isArray(payload.items) ? payload.items : [];
        const stored = storedCatalogCartItems(nextLines);
        if (cancelled) return;
        resolvedKeyRef.current = JSON.stringify(stored);
        setLines(nextLines);
        setLoading(false);
        if (!catalogCartItemsEqual(cart.v === 2 ? cart.items : [], stored) || cart.v !== 2) {
          writeCatalogCart({ v: 2, items: stored });
        }
      } catch {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, cart.items]);

  function setLineQuantity(line: CatalogCartResolvedLine, quantity: number) {
    if (quantity < 1 || quantity > line.availableQuantity) return;
    const nextCart = updateCatalogCartQuantity(cart, line, quantity, line.availableQuantity);
    const nextLines = lines.map((entry) =>
      catalogCartItemKey(entry) === catalogCartItemKey(line)
        ? { ...entry, quantity }
        : entry,
    );
    resolvedKeyRef.current = JSON.stringify(storedCatalogCartItems(nextLines));
    setLines(nextLines);
    writeCatalogCart(nextCart);
  }

  function removeLine(line: CatalogCartResolvedLine) {
    const nextCart = removeCatalogCartItem(cart, line);
    const nextLines = lines.filter(
      (entry) => catalogCartItemKey(entry) !== catalogCartItemKey(line),
    );
    resolvedKeyRef.current = JSON.stringify(storedCatalogCartItems(nextLines));
    setLines(nextLines);
    writeCatalogCart(nextCart);
    captureAnalyticsEvent(posthog, ANALYTICS_EVENTS.removeFromCart, {
      plant_id: line.plantId,
      plant_variant_id: line.plantSizeId,
      sellable_variant_id: line.sellableVariantId,
      offer_id: line.offerId,
      ...(line.potColorId ? { pot_color_id: line.potColorId } : {}),
      quantity: line.quantity,
      amount: catalogCartLineAmount(line.unitPrice, line.quantity),
    });
  }

  if (!open) return null;

  const currency = lines[0]?.currency ?? "ILS";
  const total = lines.reduce(
    (sum, line) => sum + catalogCartLineAmount(line.unitPrice, line.quantity),
    0,
  );

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/40"
        aria-label={t(locale, "shop.closeCart")}
        onClick={onClose}
      />
      <aside
        id={drawerId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-y-0 end-0 flex w-full max-w-md flex-col bg-white shadow-[0_10px_40px_rgba(15,23,42,0.18)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-4">
          <h2 id={titleId} className="text-heading-sm font-medium text-foreground">
            {t(locale, "shop.cart")}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="text-caption rounded-sm font-medium text-brand-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55"
          >
            {t(locale, "shop.closeCart")}
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5">
          {loading ? (
            <ShopSoftSpinner label={t(locale, "common.loading")} className="min-h-full" />
          ) : error ? (
            <p className="text-body text-neutral-600">{t(locale, "common.networkError")}</p>
          ) : lines.length === 0 ? (
            <ShopCartEmpty label={t(locale, "shop.cartEmpty")} />
          ) : (
            <ul className="flex flex-col gap-6">
              {lines.map((line) => {
                const name = localizedPlantText(locale, line.name, line.nameHe);
                const potColor = localizedPlantText(locale, line.potColor, line.potColorHe);
                const potLabel = [
                  localizedPlantText(locale, line.potName, line.potNameHe),
                  line.potSizeLabel,
                  potColor,
                ]
                  .filter(Boolean)
                  .join(" ");
                const lineTotal = catalogCartLineAmount(line.unitPrice, line.quantity);
                return (
                  <li key={catalogCartItemKey(line)}>
                    <article className="flex gap-3 text-start">
                      <div className="relative size-20 shrink-0 overflow-hidden rounded-2xl bg-neutral-100">
                        {line.image ? (
                          <Image
                            src={line.image}
                            alt={name}
                            fill
                            className="object-cover"
                            sizes="80px"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-body font-medium text-foreground">{name}</h3>
                        {sizeLabel(line) ? (
                          <p className="text-caption mt-1 text-neutral-600">{sizeLabel(line)}</p>
                        ) : null}
                        <p className="text-caption mt-1 text-neutral-600">
                          {formatCatalogPrice(line.unitPrice, line.currency, locale)}
                        </p>
                        {potLabel ? (
                          <p className="text-caption mt-1 text-neutral-600">{potLabel}</p>
                        ) : null}
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <div
                            className="flex items-center gap-2"
                            role="group"
                            aria-label={t(locale, "shop.cartQuantity")}
                          >
                            <button
                              type="button"
                              className={qtyButtonClass}
                              aria-label={t(locale, "shop.decreaseQuantity")}
                              disabled={line.quantity <= 1}
                              onClick={() => setLineQuantity(line, line.quantity - 1)}
                            >
                              −
                            </button>
                            <span className="text-body min-w-6 text-center font-medium">
                              {line.quantity}
                            </span>
                            <button
                              type="button"
                              className={qtyButtonClass}
                              aria-label={t(locale, "shop.increaseQuantity")}
                              disabled={line.quantity >= line.availableQuantity}
                              onClick={() => setLineQuantity(line, line.quantity + 1)}
                            >
                              +
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeLine(line)}
                            className="text-caption font-medium text-brand-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55"
                          >
                            {t(locale, "shop.cartRemove")}
                          </button>
                        </div>
                        <p className="text-body mt-3 font-medium text-foreground">
                          {formatCatalogPrice(lineTotal, line.currency, locale)}
                        </p>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="border-t border-neutral-200 px-5 py-4">
          {!loading && !error && lines.length > 0 ? (
            <p className="text-heading-sm mb-3 font-medium text-foreground">
              {t(locale, "shop.cartTotal")} {formatCatalogPrice(total, currency, locale)}
            </p>
          ) : null}
          {cart.items.length > 0 && !loading && !error && lines.length > 0 ? (
            <Link
              href={routes.shop.checkout()}
              className="text-body flex min-h-12 w-full items-center justify-center rounded-2xl bg-brand px-5 py-4 text-center font-semibold text-white shadow-[0_6px_18px_rgba(27,67,50,0.14)] transition hover:bg-brand-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2"
            >
              {t(locale, "shop.checkout")}
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="text-body flex min-h-12 w-full cursor-not-allowed items-center justify-center rounded-2xl bg-neutral-300 px-5 py-4 text-center font-semibold text-neutral-600"
            >
              {t(locale, "shop.checkout")}
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
