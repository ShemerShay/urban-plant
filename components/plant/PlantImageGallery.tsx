"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";

import { useLocale } from "@/components/locale/LocaleProvider";
import { localeHtmlDir } from "@/lib/locale";
import { t } from "@/lib/messages";

interface PlantImageGalleryProps {
  images: string[];
  name: string;
  /** Smaller gallery for checkout product summary. Default is the product-page size. */
  compact?: boolean;
}

function GalleryChevron({ pointing }: { pointing: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={`h-full w-full ${pointing === "right" ? "rotate-180" : ""}`}
    >
      <path
        d="M14.5 5.5 8 12l6.5 6.5"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlantImageGallery({ images, name, compact = false }: PlantImageGalleryProps) {
  const locale = useLocale();
  const direction = localeHtmlDir(locale);
  const emblaOptions = useMemo(
    () => ({
      align: "start" as const,
      loop: false,
      direction,
    }),
    [direction],
  );
  const [emblaRef, emblaApi] = useEmblaCarousel(emblaOptions);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!emblaApi) return;

    const onSelect = () => setSelectedIndex(emblaApi.selectedScrollSnap());
    onSelect();
    emblaApi.on("select", onSelect);

    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi]);

  const showArrows = images.length > 1;
  const atStart = selectedIndex <= 0;
  const atEnd = selectedIndex >= images.length - 1;
  const isTwoImageGallery = images.length === 2;
  const showPrevArrow = showArrows && !(isTwoImageGallery && atStart);
  const showNextArrow = showArrows && !(isTwoImageGallery && atEnd);
  const isRtl = direction === "rtl";
  const showDots = images.length > 1;
  const statusText =
    images.length > 1
      ? t(locale, "plant.gallery.statusMany", {
          name,
          current: selectedIndex + 1,
          total: images.length,
        })
      : t(locale, "plant.gallery.statusOne", { name });

  function handleViewportKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!emblaApi || images.length < 2) return;
    const rtl = direction === "rtl";
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      if (rtl) emblaApi.scrollPrev();
      else emblaApi.scrollNext();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      if (rtl) emblaApi.scrollNext();
      else emblaApi.scrollPrev();
    } else if (event.key === "Home") {
      event.preventDefault();
      emblaApi.scrollTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      emblaApi.scrollTo(images.length - 1);
    }
  }

  const arrowButtonClass = compact
    ? "absolute top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-neutral-800 shadow-[0_1px_4px_rgba(15,23,42,0.18)] backdrop-blur-[2px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55"
    : "absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-neutral-800 shadow-[0_2px_8px_rgba(15,23,42,0.18)] backdrop-blur-[2px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55";

  return (
    <section
      id="plant-image-gallery"
      className={compact ? "space-y-1.5" : "space-y-3"}
      aria-label={t(locale, "plant.gallery.photos", { name })}
    >
      <div className="relative">
        <div
          className={
            compact
              ? "overflow-hidden rounded-xl bg-neutral-100 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2"
              : "overflow-hidden rounded-[28px] bg-neutral-100 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2"
          }
          dir={direction}
          ref={emblaRef}
          tabIndex={images.length > 1 ? 0 : undefined}
          role={images.length > 1 ? "region" : undefined}
          aria-roledescription={images.length > 1 ? "carousel" : undefined}
          aria-label={statusText}
          onKeyDown={handleViewportKeyDown}
        >
          <div className="flex">
            {images.map((image, index) => (
              <div
                key={image}
                className="relative aspect-[3/4] min-h-0 min-w-0 flex-[0_0_100%]"
                aria-hidden={index !== selectedIndex}
              >
                <Image
                  src={image}
                  alt={
                    index === selectedIndex
                      ? t(locale, "plant.gallery.photoAlt", {
                          name,
                          current: index + 1,
                          total: images.length,
                        })
                      : ""
                  }
                  fill
                  priority={index === 0}
                  className="object-cover"
                  sizes={compact ? "144px" : "(max-width: 448px) 100vw, 448px"}
                />
              </div>
            ))}
          </div>
        </div>

        {showPrevArrow ? (
          <button
            type="button"
            className={`${arrowButtonClass} start-1 p-1.5 ${atStart ? "pointer-events-none" : ""}`}
            aria-label={t(locale, "plant.gallery.prev")}
            aria-disabled={atStart || undefined}
            onClick={() => {
              if (atStart) return;
              emblaApi?.scrollPrev();
            }}
          >
            <GalleryChevron pointing={isRtl ? "right" : "left"} />
          </button>
        ) : null}
        {showNextArrow ? (
          <button
            type="button"
            className={`${arrowButtonClass} end-1 p-1.5 ${atEnd ? "pointer-events-none" : ""}`}
            aria-label={t(locale, "plant.gallery.next")}
            aria-disabled={atEnd || undefined}
            onClick={() => {
              if (atEnd) return;
              emblaApi?.scrollNext();
            }}
          >
            <GalleryChevron pointing={isRtl ? "left" : "right"} />
          </button>
        ) : null}
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {statusText}
      </p>

      {showDots ? (
        <div className="flex items-center justify-center gap-0.5 pt-1" role="group" aria-label={t(locale, "plant.gallery.choose")}>
          {images.map((_, index) => (
            <button
              key={`dot-${index}`}
              type="button"
              aria-current={selectedIndex === index ? "true" : undefined}
              aria-label={t(locale, "plant.gallery.showPhoto", {
                current: index + 1,
                total: images.length,
              })}
              onClick={() => emblaApi?.scrollTo(index)}
              className={
                compact
                  ? "flex h-8 min-w-8 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2"
                  : "flex h-11 min-w-11 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2"
              }
            >
              <span
                aria-hidden
                className={`block h-1.5 rounded-full transition-[width,background-color] duration-200 motion-reduce:transition-none ${
                  selectedIndex === index
                    ? "w-5 bg-neutral-500"
                    : "w-1.5 bg-neutral-300"
                }`}
              />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
