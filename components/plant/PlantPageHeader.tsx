interface PlantPageHeaderProps {
  knownPartner: string;
}

/** Brand mark + partner label. Brand is not a navigation link (no default plant / home). */
export function PlantPageHeader({ knownPartner }: PlantPageHeaderProps) {
  return (
    <header className="mb-8 flex items-end justify-between">
      <p className="font-serif-display text-xl font-medium tracking-tight text-neutral-900">
        UrbanPlant
      </p>
      <div className="flex items-start text-[13px] font-medium tracking-[0.04em] text-[#6b7f72]">
        <svg
          className="size-4 shrink-0 text-[#6b7f72]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 21s7-4.35 7-10a7 7 0 1 0-14 0c0 5.65 7 10 7 10Z" />
          <circle cx="12" cy="11" r="2.5" />
        </svg>
        <span>{knownPartner}</span>
      </div>
    </header>
  );
}
