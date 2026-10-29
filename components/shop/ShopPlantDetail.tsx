"use client";

import { useEffect, useState } from "react";
import { usePostHog } from "posthog-js/react";

import { PlantHero } from "@/components/plant/PlantHero";
import { PlantImageGallery } from "@/components/plant/PlantImageGallery";
import { PlantProductAbout } from "@/components/plant/PlantProductAbout";
import { PlantProductInfoGrid } from "@/components/plant/PlantProductInfoGrid";
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
import type { CatalogShopDetail, CatalogShopVariant } from "@/lib/catalogShop";
import {
  catalogSizeChoices,
  resolveCardVariant,
  resolveExplicitConfiguration,
} from "@/lib/catalogShopSelection";
import { localizedPlantText } from "@/lib/plantDisplay";
import { t } from "@/lib/messages";
import type { Locale } from "@/lib/locale";

const ctaFocusClass =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2";

function variantChoiceLabel(variant: CatalogShopVariant, locale: Locale): string {
  if (!variant.potId) return t(locale, "shop.noPot");
  const name = localizedPlantText(locale, variant.potName, variant.potNameHe);
  return name || t(locale, "shop.pots");
}

export function ShopPlantDetail({ plant, locale }: { plant: CatalogShopDetail; locale: Locale }) {
  const posthog = usePostHog();
  const cart = useCatalogCart();
  const sizeOptions = catalogSizeChoices(plant.sizes);
  const [selectedSizeId, setSelectedSizeId] = useState(sizeOptions[0]?.id ?? "");
  const [selectedVariantId, setSelectedVariantId] = useState(
    () => resolveCardVariant(sizeOptions[0] ?? { id: "", quantity: 0, variants: [] })?.id ?? "",
  );
  const [justAdded, setJustAdded] = useState(false);

  const name = localizedPlantText(locale, plant.name, plant.nameHe);
  const subtitle = localizedPlantText(locale, plant.subtitle, plant.subtitleHe);
  const description = localizedPlantText(locale, plant.description, plant.descriptionHe);
  const water = localizedPlantText(locale, plant.water, plant.waterHe);
  const showCare = Boolean(plant.light && water);
  const selectedSize = sizeOptions.find((size) => size.id === selectedSizeId);
  const selectedVariant = selectedSize?.variants.find((variant) => variant.id === selectedVariantId);
  const resolved =
    selectedSize && selectedVariant
      ? resolveExplicitConfiguration(selectedSize, selectedVariant.id)
      : null;
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
    const nextSize = sizeOptions.find((size) => size.id === id);
    const nextVariant = nextSize ? resolveCardVariant(nextSize) : null;
    setSelectedSizeId(id);
    setSelectedVariantId(nextVariant?.id ?? "");
  }

  function selectVariant(id: string) {
    const nextVariant = selectedSize?.variants.find((variant) => variant.id === id);
    setSelectedVariantId(id);
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
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center">
      {plant.images.length > 0 ? (
        <div className="mx-auto w-full max-w-md">
          <PlantImageGallery
            images={plant.images}
            name={name}
            sizes="(min-width: 448px) 28rem, calc(100vw - 3rem)"
          />
        </div>
      ) : null}

      <div
        className={`flex w-full flex-col items-center gap-8 text-center ${
          plant.images.length > 0 ? "mt-8" : ""
        }`}
      >
        <PlantHero locale={locale} name={name} subtitle={subtitle} />

        {selectedSize ? (
          <>
            <section className="w-full">
              <h2 id="shop-size-heading" className="text-heading-sm font-medium text-foreground">
                {t(locale, "shop.sizes")}
              </h2>
              <CatalogSizeOptions
                sizes={plant.sizes}
                selectedId={selectedSize.id}
                onSelect={selectSize}
                locale={locale}
                labelledBy="shop-size-heading"
              />
            </section>

            <div className="w-full">
              {selectedVariant ? (
                <p className="text-heading-sm font-medium text-foreground">
                  {formatCatalogPrice(selectedVariant.unitPrice, plant.currency, locale)}
                </p>
              ) : null}
              {selectedSize.nurseryPotDiameterCm != null ? (
                <p className="text-caption mt-1 text-neutral-600">
                  {t(locale, "shop.diameter", { cm: selectedSize.nurseryPotDiameterCm })}
                </p>
              ) : null}
              <p className="text-caption mt-1 text-neutral-600">
                {resolved ? t(locale, "shop.inStock") : t(locale, "shop.unavailable")}
              </p>
            </div>

            {selectedSize.variants.length > 0 ? (
              <section className="w-full">
                <h2 id="shop-pots-heading" className="text-heading-sm font-medium text-foreground">
                  {t(locale, "shop.pots")}
                </h2>
                <div
                  className="mt-4 flex flex-wrap items-center justify-center gap-2"
                  role="radiogroup"
                  aria-labelledby="shop-pots-heading"
                >
                  {selectedSize.variants.map((variant) => {
                    const selected = variant.id === selectedVariantId;
                    return (
                      <button
                        key={variant.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => selectVariant(variant.id)}
                        className={`text-caption min-h-10 rounded-full px-4 py-2 font-medium ${ctaFocusClass} ${
                          selected
                            ? "bg-brand text-white"
                            : "bg-neutral-100 text-foreground hover:bg-neutral-200/80"
                        }`}
                      >
                        {variantChoiceLabel(variant, locale)}
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <button
              type="button"
              disabled={!canAdd}
              onClick={() => {
                void addToCart();
              }}
              className={`text-body flex min-h-12 w-full items-center justify-center rounded-2xl px-5 py-4 text-center font-semibold ${ctaFocusClass} ${
                canAdd
                  ? "bg-brand text-white shadow-[0_6px_18px_rgba(27,67,50,0.14)] transition hover:bg-brand-soft active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
                  : "cursor-not-allowed bg-neutral-300 text-neutral-600"
              }`}
            >
              {justAdded ? t(locale, "shop.addedToCart") : t(locale, "shop.addToCart")}
            </button>
          </>
        ) : null}

        {description || (showCare && plant.light) ? (
          <div className="mt-8 w-full border-t border-neutral-200 pt-12">
            {description ? (
              <div className="w-full">
                <PlantProductAbout description={description} />
              </div>
            ) : null}

            {showCare && plant.light ? (
              <div className={description ? "mt-12 w-full" : "w-full"}>
                <PlantProductInfoGrid
                  light={plant.light}
                  water={water}
                  petFriendly={plant.petFriendly}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
