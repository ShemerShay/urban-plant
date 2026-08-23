import { getLocale } from "@/lib/getLocale";
import { t } from "@/lib/messages";

export default async function CheckoutLoading() {
  const locale = await getLocale();
  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-page="checkout-page"
      className="bg-background text-foreground mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-6"
      aria-busy="true"
    >
      <span className="sr-only">{t(locale, "common.loading")}</span>
      <div className="pos-scan-spinner" aria-hidden />
      <style>{`
        .pos-scan-spinner {
          width: 1.25rem;
          height: 1.25rem;
          flex-shrink: 0;
          border-radius: 50%;
          background: conic-gradient(
            from 0deg,
            rgb(255 255 255 / 0) 0%,
            rgb(255 255 255 / 0.45) 38%,
            #6a9a82 72%,
            #497863 100%
          );
          -webkit-mask: radial-gradient(
            farthest-side,
            transparent calc(100% - 1.75px),
            #000 calc(100% - 1.75px)
          );
          mask: radial-gradient(
            farthest-side,
            transparent calc(100% - 1.75px),
            #000 calc(100% - 1.75px)
          );
          animation: pos-scan-spin 0.8s linear infinite;
        }

        @keyframes pos-scan-spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .pos-scan-spinner {
            animation: none;
          }
        }
      `}</style>
    </main>
  );
}
