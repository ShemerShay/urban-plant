import type { Locale } from "@/lib/locale";

interface PlantHeroProps {
  locale: Locale;
  name: string;
  subtitle: string;
  /** Catalog detail aligns with the size list. POS stays centered. */
  align?: "center" | "start";
}

export function PlantHero({ name, subtitle, align = "center" }: PlantHeroProps) {
  const trimmedSubtitle = subtitle.trim();
  return (
    <section
      id="plant-hero"
      className={`w-full space-y-3 ${align === "start" ? "text-start" : "text-center"}`}
    >
      <h1
        className="text-display font-medium leading-[1.12] tracking-tight text-foreground sm:text-hero"
      >
        {name}
      </h1>
      {trimmedSubtitle ? (
        <p className="text-body leading-relaxed text-neutral-500">{trimmedSubtitle}</p>
      ) : null}
    </section>
  );
}
