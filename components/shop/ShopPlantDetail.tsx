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
import { addCatalogCartItem, catalogCartItemKey, catalogCartLineAmount } from "@/lib/catalogCart";
import { useCatalogCart, writeCatalogCart } from "@/lib/catalogCartStore";
import { formatCatalogPrice } from "@/lib/catalogPriceFormat";
import type { CatalogShopDetail, CatalogShopPotOption } from "@/lib/catalogShop";
import { catalogSizeChoices, retainCompatiblePotId } from "@/lib/catalogShopSelection";
import { localizedPlantText } from "@/lib/plantDisplay";
import { t } from "@/lib/messages";
import type { Locale } from "@/lib/locale";

function PotSelector({
  pots,
  selectedId,
  onSelect,
  locale,
  currency,
}: {
  pots: CatalogShopPotOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  locale: Locale;
  currency: CatalogShopDetail["currency"];
}) {
  return (
    <section className="w-full">
      <h2 id="shop-pots-heading" className="text-heading-sm font-medium text-foreground">
        {t(locale, "shop.pots")}
      </h2>
      <ul className="mt-4 flex flex-wrap items-start justify-center gap-3" aria-labelledby="shop-pots-heading">
        {pots.map((pot) => {
          const selected = pot.id === selectedId;
          const name = localizedPlantText(locale, pot.name, pot.nameHe);
          const color = localizedPlantText(locale, pot.color, pot.colorHe);
          const price = formatCatalogPrice(pot.catalogPrice, currency, locale);
          return (
            <li key={pot.id} className="w-[5.5rem] sm:w-24">
              <button
                type="button"
                aria-pressed={selected}
                aria-label={`${name}, ${color}, ${price}`}
                onClick={() => onSelect(pot.id)}
                className="flex w-full flex-col items-center gap-1.5 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2"
              >
                <span
                  className={`relative block aspect-square w-full overflow-hidden rounded-2xl bg-neutral-100 ${
                    selected ? "ring-2 ring-brand ring-offset-2" : ""
                  }`}
                >
                  {pot.image ? (
                    <Image src={pot.image} alt="" fill className="object-cover" sizes="96px" />
                  ) : (
                    <span className="text-caption flex h-full items-center justify-center p-2 text-neutral-600">
                      {color}
                    </span>
                  )}
                </span>
                <span className="text-caption leading-snug text-neutral-600">{color}</span>
                <span className="text-caption leading-snug text-neutral-600">{price}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const ctaFocusClass =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2";

export function ShopPlantDetail({ plant, locale }: { plant: CatalogShopDetail; locale: Locale }) {
  const posthog = usePostHog();
  const cart = useCatalogCart();
  const sizeOptions = catalogSizeChoices(plant.sizes);
  const [selectedSizeId, setSelectedSizeId] = useState(sizeOptions[0]?.id ?? "");
  const [selectedPotId, setSelectedPotId] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState(false);

  const name = localizedPlantText(locale, plant.name, plant.nameHe);
  const subtitle = localizedPlantText(locale, plant.subtitle, plant.subtitleHe);
  const description = localizedPlantText(locale, plant.description, plant.descriptionHe);
  const water = localizedPlantText(locale, plant.water, plant.waterHe);
  const showCare = Boolean(plant.light && water);
  const selectedSize = sizeOptions.find((size) => size.id === selectedSizeId) ?? sizeOptions[0];
  const compatiblePots = selectedSize?.pots ?? [];
  const selectedPot = selectedPotId
    ? compatiblePots.find((pot) => pot.id === selectedPotId)
    : undefined;
  const cartQty =
    selectedSize == null
      ? 0
      : (cart.items.find(
          (item) =>
            catalogCartItemKey(item) ===
            catalogCartItemKey({
              plantId: plant.id,
              plantVariantId: selectedSize.id,
              potVariantId: selectedPotId,
            }),
        )?.quantity ?? 0);
  const canAdd =
    selectedSize != null && selectedSize.quantity > 0 && cartQty < selectedSize.quantity;

  useEffect(() => {
    if (!justAdded) return;
    const timeout = window.setTimeout(() => setJustAdded(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [justAdded]);

  function selectSize(id: string) {
    const nextSize = sizeOptions.find((size) => size.id === id);
    setSelectedSizeId(id);
    setSelectedPotId(retainCompatiblePotId(selectedPotId, nextSize?.pots ?? []));
  }

  function selectPot(id: string) {
    setSelectedPotId((current) => (current === id ? null : id));
  }

  function addToCart() {
    if (!selectedSize || !canAdd) return;
    const result = addCatalogCartItem(
      cart,
      {
        plantId: plant.id,
        plantVariantId: selectedSize.id,
        potVariantId: selectedPotId,
      },
      selectedSize.quantity,
    );
    if (!result.added) return;
    writeCatalogCart(result.cart);
    captureAnalyticsEvent(posthog, ANALYTICS_EVENTS.addToCart, {
      plant_id: plant.id,
      plant_variant_id: selectedSize.id,
      ...(selectedPotId ? { pot_variant_id: selectedPotId } : {}),
      quantity: 1,
      plant_price: selectedSize.catalogPrice,
      ...(selectedPot ? { pot_price: selectedPot.catalogPrice } : {}),
      amount: catalogCartLineAmount(
        selectedSize.catalogPrice,
        selectedPot?.catalogPrice,
        1,
      ),
    });
    setJustAdded(true);
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center">
      {plant.images.length > 0 ? (
        <div className="w-full">
          <PlantImageGallery
            images={plant.images}
            name={name}
            sizes="(min-width: 672px) 42rem, calc(100vw - 3rem)"
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
              <p className="text-heading-sm font-medium text-foreground">
                {formatCatalogPrice(selectedSize.catalogPrice, plant.currency, locale)}
              </p>
              {selectedSize.nurseryPotDiameterCm != null ? (
                <p className="text-caption mt-1 text-neutral-600">
                  {t(locale, "shop.diameter", { cm: selectedSize.nurseryPotDiameterCm })}
                </p>
              ) : null}
              <p className="text-caption mt-1 text-neutral-600">
                {selectedSize.quantity > 0 ? t(locale, "shop.inStock") : t(locale, "shop.unavailable")}
              </p>
            </div>

            {compatiblePots.length > 0 ? (
              <PotSelector
                pots={compatiblePots}
                selectedId={selectedPotId}
                onSelect={selectPot}
                locale={locale}
                currency={plant.currency}
              />
            ) : null}

            {plant.sizes.length > 0 ? (
              <button
                type="button"
                disabled={!canAdd}
                onClick={addToCart}
                className={`text-body flex min-h-12 w-full items-center justify-center rounded-2xl px-5 py-4 text-center font-semibold ${ctaFocusClass} ${
                  canAdd
                    ? "bg-brand text-white shadow-[0_6px_18px_rgba(27,67,50,0.14)] transition hover:bg-brand-soft active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
                    : "cursor-not-allowed bg-neutral-300 text-neutral-600"
                }`}
              >
                {justAdded ? t(locale, "shop.addedToCart") : t(locale, "shop.addToCart")}
              </button>
            ) : null}
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
