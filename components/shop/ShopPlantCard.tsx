import Image from "next/image";

import { ShopPlantCardActions } from "@/components/shop/ShopPlantCardActions";
import type { CatalogShopCard } from "@/lib/catalogShop";
import { localizedPlantText } from "@/lib/plantDisplay";
import type { Locale } from "@/lib/locale";

export function ShopPlantCard({
  plant,
  locale,
}: {
  plant: CatalogShopCard;
  locale: Locale;
}) {
  const name = localizedPlantText(locale, plant.name, plant.nameHe);

  return (
    <article>
      <ShopPlantCardActions
        plant={{ id: plant.id, currency: plant.currency, sizes: plant.sizes }}
        locale={locale}
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
      </ShopPlantCardActions>
    </article>
  );
}
