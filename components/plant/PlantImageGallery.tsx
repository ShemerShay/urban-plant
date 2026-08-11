"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";

interface PlantImageGalleryProps {
  images: string[];
  name: string;
}

export function PlantImageGallery({ images, name }: PlantImageGalleryProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    loop: false,
  });
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

  const showDots = images.length > 1;
  const statusText =
    images.length > 1
      ? `${name}, image ${selectedIndex + 1} of ${images.length}`
      : `${name} image`;

  function handleViewportKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!emblaApi || images.length < 2) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      emblaApi.scrollNext();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      emblaApi.scrollPrev();
    } else if (event.key === "Home") {
      event.preventDefault();
      emblaApi.scrollTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      emblaApi.scrollTo(images.length - 1);
    }
  }

  return (
    <section
      id="plant-image-gallery"
      className="space-y-3"
      aria-label={`${name} photos`}
    >
      <div
        className="overflow-hidden rounded-[28px] bg-neutral-100 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700/55 focus-visible:ring-offset-2"
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
                    ? `${name} — photo ${index + 1} of ${images.length}`
                    : ""
                }
                fill
                priority={index === 0}
                className="object-cover"
                sizes="(max-width: 448px) 100vw, 448px"
              />
            </div>
          ))}
        </div>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {statusText}
      </p>

      {showDots ? (
        <div className="flex items-center justify-center gap-0.5 pt-1" role="group" aria-label="Choose photo">
          {images.map((_, index) => (
            <button
              key={`dot-${index}`}
              type="button"
              aria-current={selectedIndex === index ? "true" : undefined}
              aria-label={`Show photo ${index + 1} of ${images.length}`}
              onClick={() => emblaApi?.scrollTo(index)}
              className="flex h-11 min-w-11 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700/55 focus-visible:ring-offset-2"
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
