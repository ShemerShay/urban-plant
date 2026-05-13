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

  return (
    <section id="plant-image-gallery" className="space-y-3">
      <div
        className="overflow-hidden rounded-[28px] bg-neutral-100 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)]"
        ref={emblaRef}
      >
        <div className="flex">
          {images.map((image, index) => (
            <div key={image} className="relative aspect-[3/4] min-h-0 min-w-0 flex-[0_0_100%]">
              <Image
                src={image}
                alt={`${name} image ${index + 1}`}
                fill
                priority={index === 0}
                className="object-cover"
                sizes="(max-width: 448px) 100vw, 448px"
              />
            </div>
          ))}
        </div>
      </div>

      {showDots ? (
        <div className="flex items-center justify-center gap-1.5 pt-1">
          {images.map((_, index) => (
            <button
              key={`dot-${index}`}
              type="button"
              aria-label={`Go to image ${index + 1}`}
              onClick={() => emblaApi?.scrollTo(index)}
              className={`h-1.5 rounded-full transition-[width,background-color] duration-200 ${
                selectedIndex === index
                  ? "w-5 bg-neutral-500"
                  : "w-1.5 bg-neutral-300 hover:bg-neutral-400"
              }`}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
