"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { CatalogPotColorOptions } from "@/components/shop/CatalogPotColorOptions";
import { CatalogSizeOptions } from "@/components/shop/CatalogSizeOptions";
import { addCatalogCartItem, catalogCartItemKey } from "@/lib/catalogCart";
import { useCatalogCart, writeCatalogCart } from "@/lib/catalogCartStore";
import { formatCatalogPrice, formatCatalogPriceSummary } from "@/lib/catalogPriceFormat";
import type { CatalogShopCard } from "@/lib/catalogShop";
import { catalogSizeChoices, retainCompatiblePotId, uniquePotColorChoices } from "@/lib/catalogShopSelection";
import { localizedPlantText } from "@/lib/plantDisplay";
import { t } from "@/lib/messages";
import { routes } from "@/lib/routes";
import type { Locale } from "@/lib/locale";

export function ShopPlantCard({ plant, locale }: { plant: CatalogShopCard; locale: Locale }) {
  const cart = useCatalogCart();
  const sizeOptions = catalogSizeChoices(plant.sizes);
  const [selectedSizeId, setSelectedSizeId] = useState(sizeOptions[0]?.id ?? "");
  const [selectedPotId, setSelectedPotId] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState(false);

  const name = localizedPlantText(locale, plant.name, plant.nameHe);
  const selectedSize = sizeOptions.find((size) => size.id === selectedSizeId) ?? sizeOptions[0];
  const potChoices = uniquePotColorChoices(selectedSize?.pots ?? []).choices;
  const selectedPot = selectedPotId
    ? potChoices.find((pot) => pot.id === selectedPotId)
    : undefined;
  const summary = formatCatalogPriceSummary(plant.priceMin, plant.priceMax, plant.currency, locale);
  const price = selectedSize
    ? formatCatalogPrice(
        selectedSize.catalogPrice + (selectedPot?.catalogPrice ?? 0),
        plant.currency,
        locale,
      )
    : summary;
  const unavailable = selectedSize ? selectedSize.quantity <= 0 : plant.unavailable;
  const cartQty =
    selectedSize == null
      ? 0
      : (cart.items.find(
          (item) =>
            catalogCartItemKey(item) ===
            catalogCartItemKey({
              plantId: plant.id,
              plantVariantId: selectedSize.id,
              potVariantId: selectedPot?.id ?? null,
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
    setSelectedPotId(
      retainCompatiblePotId(
        selectedPotId,
        uniquePotColorChoices(nextSize?.pots ?? []).choices,
      ),
    );
  }

  function addToCart() {
    if (!selectedSize || !canAdd) return;
    const potVariantId = selectedPot?.id ?? null;
    const result = addCatalogCartItem(
      cart,
      {
        plantId: plant.id,
        plantVariantId: selectedSize.id,
        potVariantId,
      },
      selectedSize.quantity,
    );
    if (!result.added) return;
    writeCatalogCart(result.cart);
    setJustAdded(true);
  }

  return (
    <article>
      <Link
        href={routes.shop.plant(plant.id)}
        className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2"
      >
        <div className="relative aspect-[3/4] overflow-hidden rounded-[28px] bg-neutral-100">
          {plant.image ? (
            <Image
              src={plant.image}
              alt={name}
              fill
              className={`object-cover ${unavailable ? "opacity-60" : ""}`}
              sizes="(max-width: 768px) 50vw, 240px"
            />
          ) : null}
        </div>
        <h2 className="text-body mt-2 font-medium leading-snug text-foreground">{name}</h2>
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
      {selectedSize || plant.unavailable ? (
        <p className="text-caption mt-1 text-neutral-600">
          {unavailable ? t(locale, "shop.unavailable") : t(locale, "shop.inStock")}
        </p>
      ) : null}
      {selectedSize ? (
        <CatalogPotColorOptions
          pots={selectedSize.pots}
          selectedId={selectedPot?.id ?? null}
          onSelect={setSelectedPotId}
          locale={locale}
        />
      ) : null}
      {selectedSize ? (
        <button
          type="button"
          disabled={!canAdd}
          onClick={addToCart}
          className={`text-caption mt-2 flex min-h-8 w-full items-center justify-center rounded-full px-2 py-1.5 text-center font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2 ${
            canAdd
              ? "bg-brand text-white transition hover:bg-brand-soft"
              : "cursor-not-allowed bg-neutral-200 text-neutral-500"
          }`}
        >
          {justAdded ? t(locale, "shop.addedToCart") : t(locale, "shop.addToCart")}
        </button>
      ) : null}
    </article>
  );
}
