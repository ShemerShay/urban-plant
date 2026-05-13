interface PlantProductAboutProps {
  description: string;
}

const CARE_NOTE =
  "Don't worry — we'll send you all the necessary care instructions with your plant.";

export function PlantProductAbout({ description }: PlantProductAboutProps) {
  return (
    <section id="plant-about" className="space-y-4 pt-2">
      <h2 className="font-serif-display text-2xl font-semibold tracking-tight text-neutral-900">
        About
      </h2>
      <p className="text-[15px] leading-7 text-neutral-600">{description}</p>
      <p className="text-sm leading-6 text-neutral-400">{CARE_NOTE}</p>
    </section>
  );
}
