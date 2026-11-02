"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import { plantMatchesCatalogSizeFilter } from "@/lib/catalogShopSelection";
import type { Locale } from "@/lib/locale";
import { t } from "@/lib/messages";
import { PLANT_SIZE_LABELS, type PlantSizeLabel } from "@/lib/plantSizes";

const focusClass =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2";

const FILTERS = ["all", ...PLANT_SIZE_LABELS] as const;

const ShopSizeFilterContext = createContext<"all" | PlantSizeLabel>("all");

export function useShopSizeFilter(): "all" | PlantSizeLabel {
  return useContext(ShopSizeFilterContext);
}

function filterLabel(locale: Locale, filter: (typeof FILTERS)[number]): string {
  if (filter === "all") return t(locale, "shop.sizeFilter.all");
  if (filter === "S") return t(locale, "plant.size.small");
  if (filter === "M") return t(locale, "plant.size.medium");
  return t(locale, "plant.size.large");
}

export function ShopCatalogSizeFilter({
  locale,
  items,
}: {
  locale: Locale;
  items: {
    id: string;
    plantSizeCodes: readonly string[];
    card: ReactNode;
  }[];
}) {
  const [filter, setFilter] = useState<"all" | PlantSizeLabel>("all");
  const visible = items.filter((item) =>
    plantMatchesCatalogSizeFilter(item.plantSizeCodes, filter),
  );

  return (
    <ShopSizeFilterContext.Provider value={filter}>
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
          {visible.map((item) => (
            <li key={`${item.id}:${filter}`}>{item.card}</li>
          ))}
        </ul>
      )}
    </ShopSizeFilterContext.Provider>
  );
}
