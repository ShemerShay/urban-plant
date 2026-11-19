import { catalogSizeChoices } from "@/lib/catalogShopSelection";
import type { CatalogShopSize } from "@/lib/catalogShop";
import { t } from "@/lib/messages";
import type { Locale } from "@/lib/locale";

const focusClass =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2";

export function CatalogSizeOptions({
  sizes,
  selectedId,
  onSelect,
  locale,
  compact = false,
  labelledBy,
}: {
  sizes: CatalogShopSize[];
  selectedId: string;
  onSelect: (id: string) => void;
  locale: Locale;
  compact?: boolean;
  labelledBy?: string;
}) {
  const options = catalogSizeChoices(sizes);
  if (options.length === 0) return null;

  return (
    <div
      className={
        compact
          ? "flex flex-wrap items-center gap-1.5"
          : "mt-4 flex flex-wrap items-center justify-center gap-2"
      }
      role="radiogroup"
      {...(labelledBy
        ? { "aria-labelledby": labelledBy }
        : { "aria-label": t(locale, "shop.sizes") })}
    >
      {options.map((size) => {
        const selected = size.id === selectedId;
        const label = size.sizeLabel ?? "";
        return (
          <button
            key={size.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(size.id)}
            className={`flex items-center justify-center rounded-full font-medium transition ${focusClass} ${
              compact ? "h-7 w-7 text-[11px]" : "h-10 w-10 text-sm"
            } ${
              selected
                ? "bg-brand text-white"
                : "bg-neutral-100 text-foreground hover:bg-neutral-200/80"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
