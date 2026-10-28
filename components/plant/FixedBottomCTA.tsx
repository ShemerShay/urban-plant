import Link from "next/link";

interface FixedBottomCTAProps {
  href: string;
  ctaText: string;
  /** When false, checkout is blocked (e.g. plant unit no longer available at location). */
  purchaseEnabled?: boolean;
}

const ctaFocusClass =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2";

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
        <button
          type="button"
          disabled
          aria-disabled="true"
          className={`text-body flex min-h-12 w-full cursor-not-allowed items-center justify-center rounded-2xl bg-neutral-300 px-5 py-4 text-center font-semibold text-neutral-600 ${ctaFocusClass}`}
        >
          {ctaText}
        </button>
      ) : (
        <Link
          href={href}
          className={`text-body flex min-h-12 w-full items-center justify-center rounded-2xl bg-brand px-5 py-4 text-center font-semibold text-white shadow-[0_10px_40px_rgba(27,67,50,0.28)] transition hover:bg-brand-soft active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100 ${ctaFocusClass}`}
        >
          {ctaText}
        </Link>
      )}
    </div>
  );
}
