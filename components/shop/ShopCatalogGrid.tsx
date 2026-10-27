"use client";

import { useState } from "react";

import { ShopPlantCard } from "@/components/shop/ShopPlantCard";
import type { CatalogShopCard } from "@/lib/catalogShop";
import { plantMatchesCatalogSizeFilter } from "@/lib/catalogShopSelection";
import type { Locale } from "@/lib/locale";
import { t } from "@/lib/messages";
import { PLANT_SIZE_LABELS, type PlantSizeLabel } from "@/lib/plantSizes";

const focusClass =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2";

const FILTERS = ["all", ...PLANT_SIZE_LABELS] as const;

function filterLabel(locale: Locale, filter: (typeof FILTERS)[number]): string {
  if (filter === "all") return t(locale, "shop.sizeFilter.all");
  if (filter === "S") return t(locale, "plant.size.small");
  if (filter === "M") return t(locale, "plant.size.medium");
  return t(locale, "plant.size.large");
}

export function ShopCatalogGrid({
  plants,
  locale,
}: {
  plants: CatalogShopCard[];
  locale: Locale;
}) {
  const [filter, setFilter] = useState<"all" | PlantSizeLabel>("all");

  if (plants.length === 0) {
    return <p className="text-body text-neutral-600">{t(locale, "shop.empty")}</p>;
  }

  const visible = plants.filter((plant) =>
    plantMatchesCatalogSizeFilter(plant.plantSizeCodes, filter),
  );

  return (
    <>
      <div
        className="mb-8 flex flex-wrap gap-2"
        role="radiogroup"
        aria-label={t(locale, "shop.sizeFilter")}
      >
        {FILTERS.map((option) => {
          const selected = option === filter;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setFilter(option)}
              className={`text-caption rounded-full px-4 py-2 font-medium transition ${focusClass} ${
                selected
                  ? "bg-brand text-white"
                  : "bg-neutral-100 text-foreground hover:bg-neutral-200/80"
              }`}
            >
              {filterLabel(locale, option)}
            </button>
          );
        })}
      </div>
      {visible.length === 0 ? (
        <p className="text-body text-neutral-600">{t(locale, "shop.sizeFilter.empty")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3">
          {visible.map((plant) => (
            <li key={`${plant.id}:${filter}`}>
              <ShopPlantCard plant={plant} locale={locale} sizeFilter={filter} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
