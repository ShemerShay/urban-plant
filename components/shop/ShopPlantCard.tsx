import Image from "next/image";
import Link from "next/link";

import { formatCatalogPriceSummary } from "@/lib/catalogPriceFormat";
import type { CatalogShopCard } from "@/lib/catalogShop";
import { localizedPlantText } from "@/lib/plantDisplay";
import { t } from "@/lib/messages";
import { routes } from "@/lib/routes";
import type { Locale } from "@/lib/locale";

export function ShopPlantCard({ plant, locale }: { plant: CatalogShopCard; locale: Locale }) {
  const name = localizedPlantText(locale, plant.name, plant.nameHe);
  const price = formatCatalogPriceSummary(plant.priceMin, plant.priceMax, plant.currency, locale);

  return (
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
            className={`object-cover ${plant.unavailable ? "opacity-60" : ""}`}
            sizes="(max-width: 768px) 50vw, 240px"
          />
        ) : null}
      </div>
      <h2 className="text-body mt-2 font-medium leading-snug text-foreground">{name}</h2>
      {price ? <p className="text-caption mt-1 text-neutral-600">{price}</p> : null}
      {plant.unavailable ? (
        <p className="text-caption mt-1 text-neutral-600">{t(locale, "shop.unavailable")}</p>
      ) : null}
    </Link>
  );
}
