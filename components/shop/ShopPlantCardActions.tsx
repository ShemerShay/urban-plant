"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePostHog } from "posthog-js/react";

import { useShopSizeFilter } from "@/components/shop/ShopCatalogSizeFilter";
import { CatalogSizeOptions } from "@/components/shop/CatalogSizeOptions";
import {
  ANALYTICS_EVENTS,
  captureAnalyticsEvent,
} from "@/lib/analyticsEvents";
import {
  addCatalogCartItem,
  catalogCartItemKey,
  catalogCartLineAmount,
} from "@/lib/catalogCart";
import { useCatalogCart, writeCatalogCart } from "@/lib/catalogCartStore";
import { formatCatalogPrice } from "@/lib/catalogPriceFormat";
import type { CatalogShopCard } from "@/lib/catalogShop";
import {
  additionalVariantOptionCount,
  catalogSizeChoices,
  defaultCatalogCardSizeId,
  resolveCardConfiguration,
} from "@/lib/catalogShopSelection";
import { t } from "@/lib/messages";
import { routes } from "@/lib/routes";
import type { Locale } from "@/lib/locale";

export function ShopPlantCardActions({
  plant,
  locale,
}: {
  plant: Pick<CatalogShopCard, "id" | "currency" | "sizes">;
  locale: Locale;
}) {
  const posthog = usePostHog();
  const cart = useCatalogCart();
  const filter = useShopSizeFilter();
  const sizeOptions = catalogSizeChoices(plant.sizes);
  const defaultSizeId = defaultCatalogCardSizeId(plant.sizes, filter);
  const [selectedSizeId, setSelectedSizeId] = useState(defaultSizeId);
  const [trackedFilter, setTrackedFilter] = useState(filter);
  const [justAdded, setJustAdded] = useState(false);

  if (trackedFilter !== filter) {
    setTrackedFilter(filter);
    setSelectedSizeId(defaultSizeId);
  }

  const selectedSize = sizeOptions.find((size) => size.id === selectedSizeId);
  const resolved = selectedSize ? resolveCardConfiguration(selectedSize) : null;
  const resolvedVariant = selectedSize?.variants.find(
    (variant) => variant.id === resolved?.sellableVariantId,
  );
  const extraOptions = additionalVariantOptionCount(
    plant.sizes,
    resolved?.sellableVariantId ?? null,
  );
  const price = resolved ? formatCatalogPrice(resolved.unitPrice, plant.currency, locale) : null;
  const cartQty =
    resolved == null
      ? 0
      : (cart.items.find(
          (item) =>
            catalogCartItemKey(item) ===
            catalogCartItemKey({
              plantId: plant.id,
              plantSizeId: resolved.plantSizeId,
              sellableVariantId: resolved.sellableVariantId,
              offerId: resolved.offerId,
            }),
        )?.quantity ?? 0);
  const canAdd = resolved != null && cartQty < resolved.availableQuantity;

  useEffect(() => {
    if (!justAdded) return;
    const timeout = window.setTimeout(() => setJustAdded(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [justAdded]);

  function selectSize(id: string) {
    setSelectedSizeId(id);
  }

  async function addToCart() {
    if (!resolved || !canAdd) return;
    const result = addCatalogCartItem(
      cart,
      {
        plantId: plant.id,
        plantSizeId: resolved.plantSizeId,
        sellableVariantId: resolved.sellableVariantId,
        offerId: resolved.offerId,
      },
      resolved.availableQuantity,
    );
    if (!result.added) return;
    writeCatalogCart(result.cart);
    captureAnalyticsEvent(posthog, ANALYTICS_EVENTS.addToCart, {
      plant_id: plant.id,
      plant_variant_id: resolved.plantSizeId,
      sellable_variant_id: resolved.sellableVariantId,
      offer_id: resolved.offerId,
      ...(resolved.potId ? { pot_id: resolved.potId } : {}),
      quantity: 1,
      amount: catalogCartLineAmount(resolved.unitPrice, 1),
      channel: "catalog",
    });
    setJustAdded(true);
  }

  return (
    <div className="mx-auto w-4/5">
      {selectedSize ? (
        <div className="mt-2">
          <CatalogSizeOptions
            sizes={plant.sizes}
            selectedId={selectedSize.id}
            onSelect={selectSize}
            locale={locale}
            compact
          />
        </div>
      ) : null}
      {price ? <p className="text-caption mt-1 text-neutral-600">{price}</p> : null}
      {resolved ? (
        <p className="text-caption mt-1 text-neutral-600">{t(locale, "shop.inStock")}</p>
      ) : null}
      {resolved && resolved.potId == null ? (
        <span className="mt-2 inline-flex items-center gap-1.5 text-neutral-700">
          <span className="inline-flex h-8 p-2 items-center justify-center overflow-hidden rounded-md border border-black/15 bg-neutral-100 px-1 text-caption leading-none">
            {t(locale, "shop.noPot")}
          </span>
        </span>
      ) : null}
      {resolved && resolved.potId != null && resolvedVariant?.potImage ? (
        <Link
          href={routes.shop.plant(plant.id)}
          aria-label={t(locale, "shop.morePotColors")}
          className="mt-2 inline-flex items-center gap-1.5 text-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2"
        >
          <span className="relative h-5 w-5 overflow-hidden rounded-md border border-black/15 bg-neutral-100">
            <Image
              src={resolvedVariant.potImage}
              alt=""
              fill
              className="object-cover"
              sizes="20px"
            />
          </span>
          {extraOptions > 0 ? <span className="text-caption">+{extraOptions}</span> : null}
        </Link>
      ) : null}
      <button
        type="button"
        disabled={!canAdd}
        onClick={() => {
          void addToCart();
        }}
        className={`text-caption mt-2 flex min-h-7 w-full items-center justify-center rounded-full px-2 py-1 text-center font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2 ${
          canAdd
            ? "bg-brand text-white transition hover:bg-brand-soft"
            : "cursor-not-allowed bg-neutral-200 text-neutral-500"
        }`}
      >
        {justAdded ? t(locale, "shop.addedToCart") : t(locale, "shop.addToCart")}
      </button>
    </div>
  );
}
