import { ShopCatalogSizeFilter } from "@/components/shop/ShopCatalogSizeFilter";
import { ShopPlantCard } from "@/components/shop/ShopPlantCard";
import type { CatalogShopCard } from "@/lib/catalogShop";
import type { Locale } from "@/lib/locale";
import { t } from "@/lib/messages";

export function ShopCatalogGrid({
  plants,
  locale,
}: {
  plants: CatalogShopCard[];
  locale: Locale;
}) {
  if (plants.length === 0) {
    return <p className="text-body text-neutral-600">{t(locale, "shop.empty")}</p>;
  }

  return (
    <ShopCatalogSizeFilter
      locale={locale}
      items={plants.map((plant) => ({
        id: plant.id,
        plantSizeCodes: plant.plantSizeCodes,
        card: <ShopPlantCard plant={plant} locale={locale} />,
      }))}
    />
  );
}
