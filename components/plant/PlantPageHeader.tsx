interface PlantPageHeaderProps {
  knownPartner: string;
}

/** Brand mark + partner label. Brand is not a navigation link (no default plant / home). */
export function PlantPageHeader({ knownPartner }: PlantPageHeaderProps) {
  return (
    <header className="mb-8 flex items-end justify-between gap-3">
      <p className="font-serif-display text-xl font-medium tracking-tight text-neutral-900">
        UrbanPlant
      </p>
      {knownPartner ? (
        <div className="flex max-w-[55%] items-start text-[13px] font-medium tracking-[0.04em] text-[#4f6358]">
          <svg
            className="mt-0.5 size-4 shrink-0 text-[#4f6358]"
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
          <span>
            <span className="sr-only">Location: </span>
            {knownPartner}
          </span>
        </div>
      ) : null}
    </header>
  );
}
