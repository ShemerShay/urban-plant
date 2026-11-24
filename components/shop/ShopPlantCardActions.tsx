"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
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
import type { CatalogShopCard, CatalogShopSize, CatalogShopVariant } from "@/lib/catalogShop";
import {
  additionalVariantOptionCount,
  catalogSizeChoices,
  defaultCatalogCardSizeId,
  resolveCardConfiguration,
  resolveExplicitConfiguration,
  variantIsEligible,
} from "@/lib/catalogShopSelection";
import { localizedPlantText } from "@/lib/plantDisplay";
import { t } from "@/lib/messages";
import { routes } from "@/lib/routes";
import type { Locale } from "@/lib/locale";

const choiceFocusClass =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2";

function eligibleNoPotVariant(size: CatalogShopSize | undefined): CatalogShopVariant | null {
  if (!size) return null;
  return (
    size.variants.find((variant) => variant.potId == null && variantIsEligible(size, variant)) ??
    null
  );
}

function eligiblePotVariants(size: CatalogShopSize | undefined): CatalogShopVariant[] {
  if (!size) return [];
  return size.variants.filter(
    (variant) => variant.potId != null && variantIsEligible(size, variant),
  );
}

/** Product page reads these when the card link is opened. */
function shopPlantHref(plantId: string, sizeId: string, variantId: string): string {
  const params = new URLSearchParams({ size: sizeId, variant: variantId });
  return `${routes.shop.plant(plantId)}?${params.toString()}`;
}

/** Shop default is the eligible no-pot offer. A pot is the default only when no no-pot offer exists. */
function defaultSellableVariantId(size: CatalogShopSize | undefined): string {
  const noPot = eligibleNoPotVariant(size);
  if (noPot) return noPot.id;
  if (!size) return "";
  return resolveCardConfiguration(size)?.sellableVariantId ?? "";
}

export function ShopPlantCardActions({
  plant,
  locale,
  children,
}: {
  plant: Pick<CatalogShopCard, "id" | "currency" | "sizes">;
  locale: Locale;
  children?: ReactNode;
}) {
  const posthog = usePostHog();
  const cart = useCatalogCart();
  const filter = useShopSizeFilter();
  const sizeOptions = catalogSizeChoices(plant.sizes);
  const defaultSizeId = defaultCatalogCardSizeId(plant.sizes, filter);
  const initialSize = sizeOptions.find((size) => size.id === defaultSizeId);
  const [selectedSizeId, setSelectedSizeId] = useState(defaultSizeId);
  const [selectedVariantId, setSelectedVariantId] = useState(defaultSellableVariantId(initialSize));
  const [trackedFilter, setTrackedFilter] = useState(filter);
  const [justAdded, setJustAdded] = useState(false);

  if (trackedFilter !== filter) {
    setTrackedFilter(filter);
    setSelectedSizeId(defaultSizeId);
    setSelectedVariantId(
      defaultSellableVariantId(sizeOptions.find((size) => size.id === defaultSizeId)),
    );
  }

  const selectedSize = sizeOptions.find((size) => size.id === selectedSizeId);
  const noPotVariant = eligibleNoPotVariant(selectedSize);
  const potOptions = eligiblePotVariants(selectedSize);
  const resolved =
    selectedSize && selectedVariantId
      ? resolveExplicitConfiguration(selectedSize, selectedVariantId)
      : null;
  const extraOptions = additionalVariantOptionCount(
    plant.sizes,
    resolved?.sellableVariantId ?? null,
  );
  const price = resolved ? formatCatalogPrice(resolved.unitPrice, plant.currency, locale) : null;
  const productHref = resolved
    ? shopPlantHref(plant.id, resolved.plantSizeId, resolved.sellableVariantId)
    : routes.shop.plant(plant.id);
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
    setSelectedVariantId(defaultSellableVariantId(sizeOptions.find((size) => size.id === id)));
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
    <>
      {children ? (
        <Link
          href={productHref}
          className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2"
        >
          {children}
        </Link>
      ) : null}
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
      {noPotVariant || potOptions.length > 0 ? (
        <div
          className="mt-2 inline-flex items-center gap-1.5 flex-wrap"
          role="radiogroup"
          aria-label={t(locale, "shop.pots")}
        >
          {noPotVariant ? (
            <button
              type="button"
              role="radio"
              aria-checked={Boolean(resolved && resolved.potId == null)}
              onClick={() => setSelectedVariantId(noPotVariant.id)}
              className={`text-caption inline-flex h-7 items-center justify-center rounded-full px-2.5 font-medium transition ${choiceFocusClass} ${
                resolved && resolved.potId == null
                  ? "bg-brand text-white"
                  : "bg-neutral-100 text-foreground hover:bg-neutral-200/80"
              }`}
            >
              {t(locale, "shop.noPot")}
            </button>
          ) : null}
          {potOptions.map((variant) => {
            const selected = resolved?.sellableVariantId === variant.id;
            return (
              <button
                key={variant.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={
                  localizedPlantText(locale, variant.potName, variant.potNameHe) ||
                  t(locale, "shop.pots")
                }
                onClick={() => setSelectedVariantId(variant.id)}
                className={`${choiceFocusClass} ${
                  selected
                    ? "relative h-5 w-5 overflow-hidden rounded-md bg-neutral-100 ring-2 ring-brand ring-offset-1"
                    : "relative h-5 w-5 overflow-hidden rounded-md border border-black/15 bg-neutral-100"
                }`}
              >
                {variant.potImage ? (
                  <Image
                    src={variant.potImage}
                    alt=""
                    fill
                    className="object-cover"
                    sizes="20px"
                  />
                ) : null}
              </button>
            );
          })}
          {extraOptions > 0 ? (
            <Link
              href={productHref}
              aria-label={t(locale, "shop.morePotColors")}
              className={`text-caption text-neutral-700 ${choiceFocusClass}`}
            >
              +{extraOptions}
            </Link>
          ) : null}
        </div>
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
    </>
  );
}
