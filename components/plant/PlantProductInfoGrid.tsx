"use client";

import type { ReactNode } from "react";

import { useLocale } from "@/components/locale/LocaleProvider";
import { lightLabel, yesNoLabel } from "@/lib/displayLabels";
import { t } from "@/lib/messages";
import type { LightLevel } from "@/lib/types";

interface PlantProductInfoGridProps {
  light: LightLevel;
  water: string;
  petFriendly: boolean;
}

/** Soft sage panel — keep in sync with premium plant page tone */
const PANEL_CLASS =
  "rounded-[28px] bg-brand-muted p-6 shadow-none outline-none sm:p-8";

const QUADRANT_ICON_SIZE = 36;

function IconSun() {
  return (
    <svg
      className="shrink-0 text-white"
      width={QUADRANT_ICON_SIZE}
      height={QUADRANT_ICON_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function IconWater() {
  return (
    <svg
      className="shrink-0 text-white"
      width={QUADRANT_ICON_SIZE}
      height={QUADRANT_ICON_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
    </svg>
  );
}

function IconCat({ slashed = false }: { slashed?: boolean }) {
  return (
    <svg
      className="shrink-0 text-white"
      width={QUADRANT_ICON_SIZE}
      height={QUADRANT_ICON_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5Z" />
      <path d="M8 14v.5" />
      <path d="M16 14v.5" />
      <path d="M11.25 16.25h1.5L12 17l-.75-.75Z" />
      {slashed ? <path d="M4.5 19.5 19.5 4.5" /> : null}
    </svg>
  );
}

const cellBase =
  "flex min-h-[5.5rem] min-w-0 flex-col items-center justify-center gap-2.5 px-2 py-5 text-center sm:min-h-[6rem] sm:px-3";

function Quadrant({
  icon,
  text,
  label,
  borders,
  hideText = false,
}: {
  icon: ReactNode;
  text: string;
  label: string;
  borders: string;
  hideText?: boolean;
}) {
  if (!text) return <div className={`${cellBase} ${borders}`} aria-hidden />;

  return (
    <div className={`${cellBase} ${borders}`}>
      {icon}
      <p
        className={
          hideText
            ? "sr-only"
            : "text-caption sm:text-body max-w-[11rem] font-medium leading-snug tracking-tight text-white sm:max-w-none"
        }
      >
        <span className="sr-only">{label}: </span>
        {text}
      </p>
    </div>
  );
}

export function PlantProductInfoGrid({
  light,
  water,
  petFriendly,
}: PlantProductInfoGridProps) {
  const locale = useLocale();
  return (
    <section id="plant-info-grid" className={PANEL_CLASS} aria-label={t(locale, "plant.info.aria")}>
      <div className="grid grid-cols-3">
        <Quadrant
          icon={<IconSun />}
          text={lightLabel(locale, light)}
          label={t(locale, "plant.info.light")}
          borders="[border-inline-end-width:1px] border-white/30"
        />
        <Quadrant
          icon={<IconWater />}
          text={water}
          label={t(locale, "plant.info.water")}
          borders="[border-inline-end-width:1px] border-white/30"
        />
        <Quadrant
          icon={<IconCat slashed={!petFriendly} />}
          text={yesNoLabel(locale, petFriendly)}
          label={t(locale, "plant.info.petFriendly")}
          borders=""
          hideText
        />
      </div>
    </section>
  );
}
