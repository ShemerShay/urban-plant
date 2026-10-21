import { uniquePotColorChoices } from "@/lib/catalogShopSelection";
import type { CatalogShopPotOption } from "@/lib/catalogShop";
import { localizedPlantText } from "@/lib/plantDisplay";
import { t } from "@/lib/messages";
import type { Locale } from "@/lib/locale";

const focusClass =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2";

export function CatalogPotColorOptions({
  pots,
  selectedId,
  onSelect,
  locale,
}: {
  pots: CatalogShopPotOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  locale: Locale;
}) {
  const { choices } = uniquePotColorChoices(pots);
  if (choices.length === 0) return null;

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-1.5"
      role="radiogroup"
      aria-label={t(locale, "shop.potColors")}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selectedId == null}
        aria-label={t(locale, "shop.noPot")}
        onClick={() => onSelect(null)}
        className={`relative h-5 w-5 rounded-full border border-neutral-300 bg-white ${focusClass} ${
          selectedId == null ? "ring-2 ring-brand/70 ring-offset-1" : ""
        }`}
      >
        <span className="absolute left-1/2 top-1/2 h-px w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-neutral-400" />
      </button>
      {choices.map((pot) => {
        const selected = pot.id === selectedId;
        const color = localizedPlantText(locale, pot.color, pot.colorHe);
        return (
          <button
            key={pot.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={color}
            title={color}
            onClick={() => onSelect(pot.id)}
            className={`h-5 w-5 rounded-full border border-black/15 ${focusClass} ${
              selected ? "ring-2 ring-brand/70 ring-offset-1" : ""
            }`}
            style={{ backgroundColor: pot.color }}
          />
        );
      })}
    </div>
  );
}
