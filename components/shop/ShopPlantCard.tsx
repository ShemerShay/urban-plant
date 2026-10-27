"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePostHog } from "posthog-js/react";

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
  additionalInStockColorCount,
  catalogSizeChoices,
  colorSetKey,
  defaultCatalogCardSizeId,
  resolveCardConfiguration,
} from "@/lib/catalogShopSelection";
import { localizedPlantText } from "@/lib/plantDisplay";
import { t } from "@/lib/messages";
import { routes } from "@/lib/routes";
import type { Locale } from "@/lib/locale";
import type { PlantSizeLabel } from "@/lib/plantSizes";

function GalleryCue() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-3.5 w-3.5">
      <path
        d="M14.5 5.5 8 12l6.5 6.5"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="origin-center rotate-180"
      />
    </svg>
  );
}

export function ShopPlantCard({
  plant,
  locale,
  sizeFilter = "all",
}: {
  plant: CatalogShopCard;
  locale: Locale;
  sizeFilter?: "all" | PlantSizeLabel;
}) {
  const posthog = usePostHog();
  const cart = useCatalogCart();
  const sizeOptions = catalogSizeChoices(plant.sizes);
  const [selectedSizeId, setSelectedSizeId] = useState(() =>
    defaultCatalogCardSizeId(plant.sizes, sizeFilter),
  );
  const [colorMemory, setColorMemory] = useState<{ colorId: string | null; setKey: string } | null>(
    null,
  );
  const [justAdded, setJustAdded] = useState(false);

  const name = localizedPlantText(locale, plant.name, plant.nameHe);
  const selectedSize = sizeOptions.find((size) => size.id === selectedSizeId);
  const resolved = selectedSize ? resolveCardConfiguration(selectedSize, colorMemory) : null;
  const resolvedVariant = resolved
    ? selectedSize?.variants.find((variant) => variant.id === resolved.sellableVariantId)
    : undefined;
  const extraColors =
    resolvedVariant && resolved
      ? additionalInStockColorCount(resolvedVariant, resolved.potColorId)
      : 0;
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
              potColorId: resolved.potColorId,
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
    setColorMemory(null);
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
        potColorId: resolved.potColorId,
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
      ...(resolved.potColorId ? { pot_color_id: resolved.potColorId } : {}),
      quantity: 1,
      amount: catalogCartLineAmount(resolved.unitPrice, 1),
    });
    setJustAdded(true);
    if (resolvedVariant) {
      setColorMemory({ colorId: resolved.potColorId, setKey: colorSetKey(resolvedVariant) });
    }
  }

  return (
    <article>
      <Link
        href={routes.shop.plant(plant.id)}
        className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2"
      >
        <div className="mx-auto w-4/5">
          <div className="relative aspect-[3/4] overflow-hidden rounded-[28px] bg-neutral-100">
            {plant.image ? (
              <Image
                src={plant.image}
                alt={name}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 40vw, 192px"
              />
            ) : null}
          </div>
          <h2 className="text-caption mt-1.5 font-medium leading-snug text-foreground">{name}</h2>
        </div>
      </Link>
      {sizeOptions.length > 0 ? (
        <div className="mt-2">
          <CatalogSizeOptions
            sizes={plant.sizes}
            selectedId={selectedSize?.id ?? ""}
            onSelect={selectSize}
            locale={locale}
            compact
          />
        </div>
      ) : null}
      {price ? <p className="text-caption mt-1 text-neutral-600">{price}</p> : null}
      {selectedSize ? (
        <p className="text-caption mt-1 text-neutral-600">
          {resolved ? t(locale, "shop.inStock") : t(locale, "shop.unavailable")}
        </p>
      ) : null}
      {resolved && resolvedVariant?.potImage ? (
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
          {extraColors > 0 ? <span className="text-caption">+{extraColors}</span> : null}
          <GalleryCue />
        </Link>
      ) : null}
      <button
        type="button"
        disabled={!canAdd}
        onClick={() => {
          void addToCart();
        }}
        className={`text-caption mt-2 flex min-h-7 mx-auto w-4/5 items-center justify-center rounded-full px-2 py-1 text-center font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2 ${
          canAdd
            ? "bg-brand text-white transition hover:bg-brand-soft"
            : "cursor-not-allowed bg-neutral-200 text-neutral-500"
        }`}
      >
        {justAdded ? t(locale, "shop.addedToCart") : t(locale, "shop.addToCart")}
      </button>
    </article>
  );
}
