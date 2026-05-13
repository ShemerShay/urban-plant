interface PlantHeroProps {
  name: string;
  subtitle: string;
}

export function PlantHero({ name, subtitle }: PlantHeroProps) {
  return (
    <section id="plant-hero" className="space-y-2">
      <h1 className="font-serif-display text-[2.125rem] font-medium leading-[1.12] tracking-tight text-neutral-900 sm:text-[2.375rem]">
        {name}
      </h1>
      <p className="text-[15px] leading-relaxed text-neutral-500">{subtitle}</p>
    </section>
  );
}
