"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useLocale } from "@/components/locale/LocaleProvider";
import { displayApiError } from "@/lib/displayLabels";
import { t } from "@/lib/messages";
import {
  MAX_PLANT_IMAGE_SOURCE_BYTES,
  MAX_PLANT_IMAGE_SOURCE_MB,
  MAX_PLANT_IMAGE_UPLOAD_BYTES,
  PLANT_IMAGE_PROCESSED_TOO_LARGE_MESSAGE,
  PLANT_IMAGE_SOURCE_TOO_LARGE_MESSAGE,
  PLANT_IMAGE_UPLOAD_FAILED_MESSAGE,
  PLANT_IMAGE_UNSUPPORTED_TYPE_MESSAGE,
  resolvePlantImageMime,
} from "@/lib/plantImageUpload";
import { preparePlantImageForUpload } from "@/lib/preparePlantImageForUpload";
import { routes } from "@/lib/routes";

type LibraryImage = {
  url: string;
  filename: string;
};

type PlantImagePickerProps = {
  images: string[];
  onChange: (urls: string[]) => void;
  plantName?: string;
};

function mergeUnique(existing: string[], added: string[]): string[] {
  const next = [...existing];
  for (const url of added) {
    const trimmed = url.trim();
    if (trimmed && !next.includes(trimmed)) next.push(trimmed);
  }
  return next;
}

export function PlantImagePicker({ images, onChange, plantName = "Plant" }: PlantImagePickerProps) {
  const locale = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryImages, setLibraryImages] = useState<LibraryImage[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [librarySelection, setLibrarySelection] = useState<Set<string>>(new Set());

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) {
        setUploadError(
          displayApiError(locale, PLANT_IMAGE_UNSUPPORTED_TYPE_MESSAGE, "admin.image.uploadFailed"),
        );
        return;
      }

      setIsUploading(true);
      setUploadError(null);
      const uploaded: string[] = [];

      try {
        for (const file of list) {
          const mime = resolvePlantImageMime(file.type, file.name);
          if (!mime) {
            throw new Error(PLANT_IMAGE_UNSUPPORTED_TYPE_MESSAGE);
          }
          if (file.size > MAX_PLANT_IMAGE_SOURCE_BYTES) {
            throw new Error(PLANT_IMAGE_SOURCE_TOO_LARGE_MESSAGE);
          }

          const prepared = await preparePlantImageForUpload(file, mime);
          if (prepared.size > MAX_PLANT_IMAGE_UPLOAD_BYTES) {
            throw new Error(PLANT_IMAGE_PROCESSED_TOO_LARGE_MESSAGE);
          }

          const body = new FormData();
          body.append("file", prepared);
          const res = await fetch(routes.api.plantImages(), { method: "POST", body });
          const data = (await res.json().catch(() => null)) as {
            image?: LibraryImage;
            error?: string;
          } | null;
          if (!res.ok || !data?.image?.url) {
            if (typeof data?.error === "string" && data.error.trim()) {
              throw new Error(data.error);
            }
            throw new Error(PLANT_IMAGE_UPLOAD_FAILED_MESSAGE);
          }
          uploaded.push(data.image.url);
        }
        onChange(mergeUnique(images, uploaded));
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim()
            ? error.message
            : PLANT_IMAGE_UPLOAD_FAILED_MESSAGE;
        setUploadError(displayApiError(locale, message, "admin.image.uploadFailed"));
        if (uploaded.length > 0) {
          onChange(mergeUnique(images, uploaded));
        }
      } finally {
        setIsUploading(false);
      }
    },
    [images, locale, onChange],
  );

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true);
    setLibraryError(null);
    try {
      const res = await fetch(routes.api.plantImages(), { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        images?: LibraryImage[];
        error?: string;
      };
      if (!res.ok) {
        setLibraryError(displayApiError(locale, data.error, "admin.image.loadLibraryFailed"));
        setLibraryImages([]);
        return;
      }
      setLibraryImages(data.images ?? []);
    } catch {
      setLibraryError(t(locale, "admin.image.loadLibraryNetwork"));
      setLibraryImages([]);
    } finally {
      setLibraryLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    if (!libraryOpen) return;
    void loadLibrary();
    setLibrarySelection(new Set(images));
  }, [libraryOpen, loadLibrary, images]);

  function removeImage(url: string) {
    onChange(images.filter((item) => item !== url));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (isUploading) return;
    void uploadFiles(e.dataTransfer.files);
  }

  function toggleLibraryUrl(url: string) {
    setLibrarySelection((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function applyLibrarySelection() {
    onChange(mergeUnique(images, [...librarySelection]));
    setLibraryOpen(false);
  }

  return (
    <div className="space-y-3">
      {images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {images.map((src) => (
            <div key={src} className="relative">
              <img
                src={src}
                alt={plantName}
                className="h-24 w-24 rounded-xl object-cover ring-1 ring-slate-200"
              />
              <button
                type="button"
                onClick={() => removeImage(src)}
                className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white shadow"
                aria-label={t(locale, "admin.image.removeAria")}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (e.currentTarget === e.target) setIsDragging(false);
        }}
        onDrop={handleDrop}
        className={`rounded-2xl border-2 border-dashed px-4 py-8 text-center transition ${
          isDragging
            ? "border-emerald-500 bg-emerald-50/80"
            : "border-slate-200 bg-slate-50/50"
        } ${isUploading ? "pointer-events-none opacity-60" : ""}`}
      >
        <p className="text-sm font-medium text-slate-800">
          {isUploading ? t(locale, "admin.image.uploading") : t(locale, "admin.image.dragHere")}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {t(locale, "admin.image.hint", { maxMb: MAX_PLANT_IMAGE_SOURCE_MB })}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            disabled={isUploading}
            onClick={() => inputRef.current?.click()}
            className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50"
          >
            {t(locale, "admin.image.chooseFiles")}
          </button>
          <button
            type="button"
            disabled={isUploading}
            onClick={() => setLibraryOpen(true)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {t(locale, "admin.image.chooseFromLibrary")}
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) void uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {uploadError ? <p className="text-sm text-red-700">{uploadError}</p> : null}

      {libraryOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="plant-library-title"
          onClick={() => setLibraryOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h3 id="plant-library-title" className="text-base font-semibold text-emerald-950">
                {t(locale, "admin.image.libraryTitle")}
              </h3>
              <button
                type="button"
                onClick={() => setLibraryOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
              >
                {t(locale, "admin.common.close")}
              </button>
            </div>

            <div className="max-h-[50vh] overflow-y-auto p-4">
              {libraryLoading ? (
                <p className="text-sm text-slate-600">{t(locale, "admin.image.libraryLoading")}</p>
              ) : libraryError ? (
                <p className="text-sm text-red-700">{libraryError}</p>
              ) : libraryImages.length === 0 ? (
                <p className="text-sm text-slate-600">{t(locale, "admin.image.libraryEmpty")}</p>
              ) : (
                <ul className="grid grid-cols-3 gap-2">
                  {libraryImages.map((item) => {
                    const selected = librarySelection.has(item.url);
                    return (
                      <li key={item.url}>
                        <button
                          type="button"
                          onClick={() => toggleLibraryUrl(item.url)}
                          className={`relative w-full overflow-hidden rounded-xl ring-2 transition ${
                            selected ? "ring-emerald-600" : "ring-transparent"
                          }`}
                        >
                          <img
                            src={item.url}
                            alt=""
                            className="aspect-square w-full object-cover"
                          />
                          {selected ? (
                            <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-700 text-xs text-white">
                              ✓
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex gap-2 border-t border-slate-100 p-4">
              <button
                type="button"
                onClick={applyLibrarySelection}
                disabled={librarySelection.size === 0}
                className="flex-1 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50"
              >
                {t(locale, "admin.image.addSelected", { count: librarySelection.size })}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
