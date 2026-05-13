import type { ReactNode } from "react";

import { PlantProduct } from "@/lib/types";

interface PlantProductInfoGridProps {
  light: PlantProduct["light"];
  water: string;
  difficulty: PlantProduct["difficulty"];
  labels: string[];
}

/** Soft sage panel — keep in sync with premium plant page tone */
const PANEL_CLASS =
  "rounded-[28px] bg-[#7a8f7c] p-6 shadow-none outline-none sm:p-8";

function lightDisplay(light: PlantProduct["light"]): string {
  switch (light) {
    case "Low light":
      return "Low light";
    case "Indirect bright light":
      return "Medium light";
    case "Full sun":
      return "Bright light";
  }
}

function careDisplay(difficulty: PlantProduct["difficulty"]): string {
  switch (difficulty) {
    case "Easy":
      return "Easy care";
    case "Moderate":
      return "Moderate care";
    case "Advanced":
      return "Attentive care";
  }
}

function sizeDisplay(labels: string[]): string {
  const joined = labels.join(" ").toLowerCase();
  if (/\bsmall\b/.test(joined)) return "Small size";
  if (/\bmedium\b/.test(joined)) return "Medium size";
  if (/\blarge\b/.test(joined)) return "Large size";
  return "Medium size";
}

function IconSun() {
  return (
    <svg
      className="shrink-0 text-white"
      width="28"
      height="28"
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
      width="28"
      height="28"
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
      width="28"
      height="28"
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
      width="28"
      height="28"
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

function Quadrant({ icon, text, borders }: { icon: ReactNode; text: string; borders: string }) {
  return (
    <div id="plant-info-grid-cell" className={`${cellBase} ${borders}`}>
      {icon}
      <p className="max-w-[11rem] text-[13px] font-medium leading-snug tracking-tight text-white sm:max-w-none sm:text-sm">
        {text}
      </p>
    </div>
  );
}

export function PlantProductInfoGrid({
  light,
  water,
  difficulty,
  labels,
}: PlantProductInfoGridProps) {
  return (
    <section id="plant-info-grid" className={PANEL_CLASS}>
      <div className="grid grid-cols-2">
        <Quadrant
          icon={<IconSun />}
          text={lightDisplay(light)}
          borders="border-b border-r border-white/30"
        />
        <Quadrant icon={<IconWater />} text={water} borders="border-b border-white/30" />
        <Quadrant
          icon={<IconSprout />}
          text={careDisplay(difficulty)}
          borders="border-r border-white/30"
        />
        <Quadrant icon={<IconRuler />} text={sizeDisplay(labels)} borders="" />
      </div>
    </section>
  );
}
