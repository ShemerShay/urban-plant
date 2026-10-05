import Image from "next/image";

import { PlantHero } from "@/components/plant/PlantHero";
import { PlantImageGallery } from "@/components/plant/PlantImageGallery";
import { PlantProductAbout } from "@/components/plant/PlantProductAbout";
import { PlantProductInfoGrid } from "@/components/plant/PlantProductInfoGrid";
import { formatCatalogPrice } from "@/lib/catalogPriceFormat";
import type { CatalogShopDetail, CatalogShopPotOption, CatalogShopSize } from "@/lib/catalogShop";
import { localizedPlantText } from "@/lib/plantDisplay";
import { t } from "@/lib/messages";
import type { Locale } from "@/lib/locale";

function PotOption({
  pot,
  locale,
  currency,
}: {
  pot: CatalogShopPotOption;
  locale: Locale;
  currency: CatalogShopDetail["currency"];
}) {
  const name = localizedPlantText(locale, pot.name, pot.nameHe);
  const color = localizedPlantText(locale, pot.color, pot.colorHe);
  return (
    <li className="flex items-center gap-3">
      {pot.image ? (
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-neutral-100">
          <Image src={pot.image} alt="" fill className="object-cover" sizes="56px" />
        </div>
      ) : null}
      <div>
        <p className="text-body font-medium text-foreground">{name}</p>
        <p className="text-caption text-neutral-600">
          {color}
          {" · "}
          {formatCatalogPrice(pot.catalogPrice, currency, locale)}
        </p>
      </div>
    </li>
  );
}

function SizeOption({
  size,
  locale,
  currency,
}: {
  size: CatalogShopSize;
  locale: Locale;
  currency: CatalogShopDetail["currency"];
}) {
  const inStock = size.quantity > 0;
  return (
    <li className="border-t border-neutral-200 py-4 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          {size.sizeLabel ? (
            <p className="text-body font-medium text-foreground">{size.sizeLabel}</p>
          ) : null}
          {size.nurseryPotDiameterCm != null ? (
            <p className="text-caption text-neutral-600">
              {t(locale, "shop.diameter", { cm: size.nurseryPotDiameterCm })}
            </p>
          ) : null}
        </div>
        <p className="text-body font-medium text-foreground">
          {formatCatalogPrice(size.catalogPrice, currency, locale)}
        </p>
      </div>
      <p className="text-caption mt-1 text-neutral-600">
        {inStock ? t(locale, "shop.inStock") : t(locale, "shop.unavailable")}
      </p>
      {size.pots.length > 0 ? (
        <div className="mt-3">
          <h3 className="text-caption font-medium text-neutral-600">{t(locale, "shop.pots")}</h3>
          <ul className="mt-2 space-y-2">
            {size.pots.map((pot) => (
              <PotOption key={pot.id} pot={pot} locale={locale} currency={currency} />
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

export function ShopPlantDetail({ plant, locale }: { plant: CatalogShopDetail; locale: Locale }) {
  const name = localizedPlantText(locale, plant.name, plant.nameHe);
  const subtitle = localizedPlantText(locale, plant.subtitle, plant.subtitleHe);
  const description = localizedPlantText(locale, plant.description, plant.descriptionHe);
  const water = localizedPlantText(locale, plant.water, plant.waterHe);
  const showCare = Boolean(plant.light && plant.difficulty && water);

  return (
    <div className="flex flex-1 flex-col">
      <div
        className={
          plant.images.length > 0
            ? "lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] lg:items-start lg:gap-12"
            : undefined
        }
      >
        {plant.images.length > 0 ? (
          <PlantImageGallery
            images={plant.images}
            name={name}
            sizes="(min-width: 1024px) 38rem, calc(100vw - 3rem)"
          />
        ) : null}

        <div
          className={`flex min-w-0 flex-col gap-8 ${plant.images.length > 0 ? "mt-8 lg:mt-2" : ""}`}
        >
          <PlantHero locale={locale} name={name} subtitle={subtitle} align="start" />

          {plant.sizes.length > 0 ? (
            <section className="w-full text-start" aria-label={t(locale, "shop.sizes")}>
              <h2 className="text-heading-sm font-medium text-foreground">{t(locale, "shop.sizes")}</h2>
              <ul className="mt-4">
                {plant.sizes.map((size) => (
                  <SizeOption key={size.id} size={size} locale={locale} currency={plant.currency} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>

      {description || (showCare && plant.light && plant.difficulty) ? (
        <div className="mt-16 w-full border-t border-neutral-200 pt-12 lg:mx-auto lg:max-w-2xl">
          {description ? (
            <div className="w-full">
              <PlantProductAbout description={description} />
            </div>
          ) : null}

          {showCare && plant.light && plant.difficulty ? (
            <div className={description ? "mt-12 w-full" : "w-full"}>
              <PlantProductInfoGrid
                light={plant.light}
                water={water}
                difficulty={plant.difficulty}
                averageSize={plant.averageSize}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
