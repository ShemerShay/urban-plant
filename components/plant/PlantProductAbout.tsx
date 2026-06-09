interface PlantProductAboutProps {
  description: string;
}

export function PlantProductAbout({ description }: PlantProductAboutProps) {
  return (
    <section id="plant-about" className="w-full space-y-2 text-center">
      <h2 className="font-serif-display text-2xl font-semibold tracking-tight text-neutral-900">
        About
      </h2>
      <p className="text-[15px] leading-7 text-neutral-600">{description}</p>
    </section>
  );
}
