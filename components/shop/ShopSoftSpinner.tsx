export function ShopSoftSpinner({
  label,
  className = "min-h-40",
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-1 items-center justify-center ${className}`}
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">{label}</span>
      <span className="shop-cart-spinner" aria-hidden />
      <style>{`
        .shop-cart-spinner {
          width: 1rem;
          height: 1rem;
          flex-shrink: 0;
          border-radius: 50%;
          background: conic-gradient(
            from 0deg,
            rgb(255 255 255 / 0) 0%,
            rgb(73 120 99 / 0.22) 38%,
            var(--brand-muted) 72%,
            var(--brand) 100%
          );
          -webkit-mask: radial-gradient(
            farthest-side,
            transparent calc(100% - 1.5px),
            #000 calc(100% - 1.5px)
          );
          mask: radial-gradient(
            farthest-side,
            transparent calc(100% - 1.5px),
            #000 calc(100% - 1.5px)
          );
          animation: shop-cart-spin 0.9s linear infinite;
        }

        @keyframes shop-cart-spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .shop-cart-spinner {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
