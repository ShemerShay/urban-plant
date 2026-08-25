"use client";

import type { ReactNode } from "react";

import { useLocale } from "@/components/locale/LocaleProvider";
import { careLabel, lightLabel, sizeLabel } from "@/lib/displayLabels";
import { t } from "@/lib/messages";
import type { CareLevel, LightLevel, PlantProduct } from "@/lib/types";

interface PlantProductInfoGridProps {
  light: LightLevel;
  water: string;
  difficulty: CareLevel;
  averageSize?: PlantProduct["averageSize"];
}

/** Soft sage panel — keep in sync with premium plant page tone */
const PANEL_CLASS =
  "rounded-[28px] bg-[#7a8f7c] p-6 shadow-none outline-none sm:p-8";

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

function IconSprout() {
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
      <path d="M12 22V11" />
      <path d="M12 11C10.5 8 7.5 5.5 5 6c0 4 3 7 7 7.5" />
      <path d="M12 11c1.5-3 4.5-5.5 7-6 0 4-3 7-7 7.5" />
    </svg>
  );
}

function IconRuler() {
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
      <path d="M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M11 7h3M11 11h3M11 15h2" />
    </svg>
  );
}

const cellBase =
  "flex min-h-[5.5rem] flex-col items-center justify-center gap-2.5 px-3 py-5 text-center sm:min-h-[6rem] sm:px-4";

function Quadrant({
  icon,
  text,
  label,
  borders,
}: {
  icon: ReactNode;
  text: string;
  label: string;
  borders: string;
}) {
  if (!text) return <div className={`${cellBase} ${borders}`} aria-hidden />;

  return (
    <div className={`${cellBase} ${borders}`}>
      {icon}
      <p className="max-w-[11rem] text-[13px] font-medium leading-snug tracking-tight text-white sm:max-w-none sm:text-sm">
        <span className="sr-only">{label}: </span>
        {text}
      </p>
    </div>
  );
}

export function PlantProductInfoGrid({
  light,
  water,
  difficulty,
  averageSize,
}: PlantProductInfoGridProps) {
  const locale = useLocale();
  return (
    <section id="plant-info-grid" className={PANEL_CLASS} aria-label={t(locale, "plant.info.aria")}>
      <div className="grid grid-cols-2">
        <Quadrant
          icon={<IconSun />}
          text={lightLabel(locale, light)}
          label={t(locale, "plant.info.light")}
          borders="border-b [border-inline-end-width:1px] border-white/30"
        />
        <Quadrant
          icon={<IconWater />}
          text={water}
          label={t(locale, "plant.info.water")}
          borders="border-b border-white/30"
        />
        <Quadrant
          icon={<IconSprout />}
          text={careLabel(locale, difficulty)}
          label={t(locale, "plant.info.care")}
          borders="[border-inline-end-width:1px] border-white/30"
        />
        <Quadrant
          icon={<IconRuler />}
          text={sizeLabel(locale, averageSize)}
          label={t(locale, "plant.info.size")}
          borders=""
        />
      </div>
    </section>
  );
}
