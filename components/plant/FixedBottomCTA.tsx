import Link from "next/link";

interface FixedBottomCTAProps {
  href: string;
  ctaText: string;
  /** When false, checkout is blocked (e.g. plant unit no longer available at location). */
  purchaseEnabled?: boolean;
}

export function FixedBottomCTA({
  href,
  ctaText,
  purchaseEnabled = true,
}: FixedBottomCTAProps) {
  const disabled = !purchaseEnabled;

  return (
    <div
      id="plant-fixed-bottom-cta"
      className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3"
    >
      {disabled ? (
        <div
          role="button"
          aria-disabled="true"
          tabIndex={-1}
          className="flex w-full cursor-not-allowed items-center justify-center rounded-2xl bg-neutral-300 px-5 py-4 text-center text-base font-semibold text-neutral-500"
        >
          {ctaText}
        </div>
      ) : (
        <Link
          href={href}
          className="flex w-full items-center justify-center rounded-2xl bg-[#497863] px-5 py-4 text-center text-base font-semibold text-white shadow-[0_10px_40px_rgba(27,67,50,0.28)] transition hover:bg-[#163529] active:scale-[0.99]"
        >
          {ctaText}
        </Link>
      )}
    </div>
  );
}
