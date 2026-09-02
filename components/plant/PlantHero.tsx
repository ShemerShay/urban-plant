import type { Locale } from "@/lib/locale";

interface PlantHeroProps {
  locale: Locale;
  name: string;
  subtitle: string;
}

export function PlantHero({ name, subtitle }: PlantHeroProps) {
  return (
    <section id="plant-hero" className="w-full space-y-3 text-center">
      <h1
        className="text-display font-medium leading-[1.12] tracking-tight text-foreground sm:text-hero"
      >
        {name}
      </h1>
      <p className="text-body leading-relaxed text-neutral-500">{subtitle}</p>
    </section>
  );
}
