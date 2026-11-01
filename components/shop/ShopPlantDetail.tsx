"use client";

import Image from "next/image";
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
import type { CatalogShopDetail, CatalogShopSize, CatalogShopVariant } from "@/lib/catalogShop";
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

const potChoiceClass = (selected: boolean) =>
  `relative flex h-[4.5rem] w-[4.5rem] items-center justify-center overflow-hidden rounded-2xl bg-neutral-100 px-1 text-center text-caption font-medium leading-tight text-foreground ${ctaFocusClass} ${
    selected ? "ring-2 ring-brand ring-offset-2" : "ring-1 ring-black/15 hover:ring-black/30"
  }`;

/** Approved card default: one eligible pot, otherwise the eligible no-pot variant. */
function initialVariantSelection(size: CatalogShopSize | undefined): {
  variantId: string;
  noPot: boolean;
} {
  const variant = size
    ? resolveCardVariant({ id: size.id, quantity: size.quantity, variants: size.variants })
    : null;
  if (!variant || variant.potId == null) {
    return { variantId: variant?.id ?? "", noPot: true };
  }
  return { variantId: variant.id, noPot: false };
}

function potOptionLabel(variant: CatalogShopVariant, locale: Locale): string {
  return localizedPlantText(locale, variant.potName, variant.potNameHe) || t(locale, "shop.pots");
}

export function ShopPlantDetail({ plant, locale }: { plant: CatalogShopDetail; locale: Locale }) {
  const posthog = usePostHog();
  const cart = useCatalogCart();
  const sizeOptions = catalogSizeChoices(plant.sizes);
  const initialSelection = initialVariantSelection(sizeOptions[0]);
  const [selectedSizeId, setSelectedSizeId] = useState(sizeOptions[0]?.id ?? "");
  const [selectedVariantId, setSelectedVariantId] = useState(initialSelection.variantId);
  const [noPotSelected, setNoPotSelected] = useState(initialSelection.noPot);
  const [justAdded, setJustAdded] = useState(false);

  const name = localizedPlantText(locale, plant.name, plant.nameHe);
  const subtitle = localizedPlantText(locale, plant.subtitle, plant.subtitleHe);
  const description = localizedPlantText(locale, plant.description, plant.descriptionHe);
  const water = localizedPlantText(locale, plant.water, plant.waterHe);
  const showCare = Boolean(plant.light && water);
  const selectedSize = sizeOptions.find((size) => size.id === selectedSizeId);
  const potVariants = selectedSize?.variants.filter((variant) => variant.potId != null) ?? [];
  const noPotVariant = selectedSize?.variants.find((variant) => variant.potId == null);
  const selectedVariant = noPotSelected
    ? noPotVariant
    : selectedSize?.variants.find((variant) => variant.id === selectedVariantId);
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
    const next = initialVariantSelection(sizeOptions.find((size) => size.id === id));
    setSelectedSizeId(id);
    setSelectedVariantId(next.variantId);
    setNoPotSelected(next.noPot);
  }

  function selectPot(id: string) {
    setNoPotSelected(false);
    setSelectedVariantId(id);
  }

  function selectNoPot() {
    setNoPotSelected(true);
    setSelectedVariantId(noPotVariant?.id ?? "");
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

            {potVariants.length > 0 || noPotVariant ? (
              <section className="w-full">
                <h2 id="shop-pots-heading" className="text-heading-sm font-medium text-foreground">
                  {t(locale, "shop.pots")}
                </h2>
                <div
                  className="mt-4 flex flex-wrap items-center justify-center gap-3"
                  role="radiogroup"
                  aria-labelledby="shop-pots-heading"
                >
                  {potVariants.map((variant) => {
                    const selected = !noPotSelected && variant.id === selectedVariantId;
                    return (
                      <button
                        key={variant.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={potOptionLabel(variant, locale)}
                        onClick={() => selectPot(variant.id)}
                        className={potChoiceClass(selected)}
                      >
                        {variant.potImage ? (
                          <Image
                            src={variant.potImage}
                            alt=""
                            fill
                            className="object-cover"
                            sizes="72px"
                          />
                        ) : null}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={noPotSelected}
                    onClick={selectNoPot}
                    className={potChoiceClass(noPotSelected)}
                  >
                    {t(locale, "shop.noPot")}
                  </button>
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
