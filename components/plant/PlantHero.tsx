import { localeDisplayFontClass, type Locale } from "@/lib/locale";

interface PlantHeroProps {
  locale: Locale;
  name: string;
  subtitle: string;
}

export function PlantHero({ locale, name, subtitle }: PlantHeroProps) {
  return (
    <section id="plant-hero" className="w-full space-y-3 text-center">
      <h1
        className={`${localeDisplayFontClass(locale)} text-[2.125rem] font-medium leading-[1.12] tracking-tight text-neutral-900 sm:text-[2.375rem]`}
      >
        {name}
      </h1>
      <p className="text-[15px] leading-relaxed text-neutral-500">{subtitle}</p>
    </section>
  );
}
