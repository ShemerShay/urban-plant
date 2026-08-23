"use client";

import { useLocale } from "@/components/locale/LocaleProvider";
import { localeDisplayFontClass } from "@/lib/locale";
import { t } from "@/lib/messages";

interface PlantProductAboutProps {
  description: string;
}

export function PlantProductAbout({ description }: PlantProductAboutProps) {
  const locale = useLocale();
  return (
    <section id="plant-about" className="w-full space-y-2 text-center">
      <h2
        className={`${localeDisplayFontClass(locale)} text-2xl tracking-tight text-neutral-900 ${
          locale === "he" ? "font-normal" : "font-semibold"
        }`}
      >
        {t(locale, "plant.about")}
      </h2>
      <p className="text-[15px] leading-7 text-neutral-600">{description}</p>
    </section>
  );
}
