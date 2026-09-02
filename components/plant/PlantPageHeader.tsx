"use client";

import { LanguageSwitcher } from "@/components/locale/LanguageSwitcher";
import { useLocale } from "@/components/locale/LocaleProvider";
import { t } from "@/lib/messages";

interface PlantPageHeaderProps {
  knownPartner: string;
}

/** Brand mark + partner label. Brand is not a navigation link (no default plant / home). */
export function PlantPageHeader({ knownPartner }: PlantPageHeaderProps) {
  const locale = useLocale();
  return (
    <header className="mb-8 flex flex-row-reverse items-end justify-between gap-3" dir="ltr">
      <p className="font-display text-heading-sm font-medium tracking-tight text-foreground">
        UrbanPlant
      </p>
      <div className="flex max-w-[55%] flex-col items-start gap-1.5">
        <LanguageSwitcher />
        {knownPartner ? (
          <div className="text-caption text-brand-soft flex items-start font-medium tracking-[0.04em]">
            <svg
              className="text-brand-soft mt-0.5 size-4 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 21s7-4.35 7-10a7 7 0 1 0-14 0c0 5.65 7 10 7 10Z" />
              <circle cx="12" cy="11" r="2.5" />
            </svg>
            <span>
              <span className="sr-only">{t(locale, "common.location")}</span>
              {knownPartner}
            </span>
          </div>
        ) : null}
      </div>
    </header>
  );
}
