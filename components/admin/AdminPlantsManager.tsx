"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PlantImagePicker } from "@/components/admin/PlantImagePicker";
import { AdminConfirmDialog } from "@/components/admin/shared/AdminConfirmDialog";
import { adminCheckboxClassName } from "@/components/admin/shared/adminSelectionStyles";
import { useLocale } from "@/components/locale/LocaleProvider";
import {
  careLabel,
  displayApiError,
  lightLabel,
  sizeLabel,
  yesNoLabel,
} from "@/lib/displayLabels";
import { formatPrice } from "@/lib/mockPlants";
import { t } from "@/lib/messages";
import { routes } from "@/lib/routes";
import type { InventoryType } from "@/lib/inventoryType";
import type { PlantProduct } from "@/lib/types";

type PlantsApiResponse = {
  plants?: PlantProduct[];
  plant?: PlantProduct;
  error?: string;
  ok?: boolean;
};

type PlantDraft = {
  id: string;
  name: string;
  nameHe: string;
  family: string;
  subtitle: string;
  subtitleHe: string;
  description: string;
  descriptionHe: string;
  price: string;
  currency: PlantProduct["currency"];
  imagesText: string;
  labelsText: string;
  light: PlantProduct["light"];
  water: string;
  waterHe: string;
  averageSize: PlantProduct["averageSize"] | "";
  supplierName: string;
  baseSupplierPrice: string;
  difficulty: PlantProduct["difficulty"];
  location: string;
  petFriendly: boolean;
  careInstructionsText: string;
};

const LIGHT_OPTIONS: PlantProduct["light"][] = [
  "Low light",
  "Medium light",
  "Bright indirect light",
  "Direct sun",
];

const DIFFICULTY_OPTIONS: PlantProduct["difficulty"][] = ["Easy", "Moderate", "Advanced"];

const CURRENCY_OPTIONS: PlantProduct["currency"][] = ["ILS", "USD", "EUR"];

const SIZE_VALUES: NonNullable<PlantProduct["averageSize"]>[] = [
  "small",
  "medium",
  "large",
  "x-large",
];

function linesFromArray(values: string[]): string {
  return values.join("\n");
}

function arrayFromLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function plantToDraft(plant: PlantProduct): PlantDraft {
  return {
    id: plant.id,
    name: plant.name,
    nameHe: plant.nameHe ?? "",
    family: plant.family ?? "",
    subtitle: plant.subtitle,
    subtitleHe: plant.subtitleHe ?? "",
    description: plant.description,
    descriptionHe: plant.descriptionHe ?? "",
    price: String(plant.price),
    currency: plant.currency,
    imagesText: linesFromArray(plant.images),
    labelsText: linesFromArray(plant.labels),
    light: plant.light,
    water: plant.water,
    waterHe: plant.waterHe ?? "",
    averageSize: plant.averageSize ?? "",
    supplierName: plant.supplierName ?? "",
    baseSupplierPrice:
      typeof plant.baseSupplierPrice === "number" ? String(plant.baseSupplierPrice) : "",
    difficulty: plant.difficulty,
    location: plant.location,
    petFriendly: plant.petFriendly,
    careInstructionsText: linesFromArray(plant.careInstructions),
  };
}

function emptyDraft(): PlantDraft {
  return {
    id: "",
    name: "",
    nameHe: "",
    family: "",
    subtitle: "",
    subtitleHe: "",
    description: "",
    descriptionHe: "",
    price: "",
    currency: "ILS",
    imagesText: "",
    labelsText: "",
    light: "Bright indirect light",
    water: "",
    waterHe: "",
    averageSize: "",
    supplierName: "",
    baseSupplierPrice: "",
    difficulty: "Easy",
    location: "",
    petFriendly: false,
    careInstructionsText: "",
  };
}

function draftToPayload(draft: PlantDraft, options?: { omitId?: boolean }): Record<string, unknown> {
  const price = Number(draft.price);
  const baseSupplierPrice =
    draft.baseSupplierPrice.trim() === "" ? undefined : Number(draft.baseSupplierPrice);

  return {
    ...(options?.omitId ? {} : { id: draft.id.trim() }),
    name: draft.name.trim(),
    nameHe: draft.nameHe.trim(),
    ...(draft.family.trim() ? { family: draft.family.trim() } : {}),
    subtitle: draft.subtitle.trim(),
    subtitleHe: draft.subtitleHe.trim(),
    description: draft.description.trim(),
    descriptionHe: draft.descriptionHe.trim(),
    price,
    currency: draft.currency,
    images: arrayFromLines(draft.imagesText),
    labels: arrayFromLines(draft.labelsText),
    light: draft.light,
    water: draft.water.trim(),
    waterHe: draft.waterHe.trim(),
    ...(draft.averageSize ? { averageSize: draft.averageSize } : {}),
    ...(draft.supplierName.trim() ? { supplierName: draft.supplierName.trim() } : {}),
    ...(baseSupplierPrice !== undefined && Number.isFinite(baseSupplierPrice)
      ? { baseSupplierPrice }
      : {}),
    difficulty: draft.difficulty,
    location: draft.location.trim(),
    petFriendly: draft.petFriendly,
    careInstructions: arrayFromLines(draft.careInstructionsText),
  };
}

function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPencil({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 20h4l10.5-10.5a2.12 2.12 0 00-3-3L5 17v3zM14.5 6.5l3 3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconTrash({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconChevron({ className, open }: { className?: string; open: boolean }) {
  return (
    <svg
      className={`${className ?? ""} transition-transform ${open ? "rotate-180" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function plantMatchesSearch(plant: PlantProduct, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    plant.id,
    plant.name,
    plant.nameHe,
    plant.family,
    plant.subtitle,
    plant.subtitleHe,
    plant.description,
    plant.descriptionHe,
    plant.currency,
    String(plant.price),
    plant.light,
    plant.water,
    plant.waterHe,
    plant.difficulty,
    plant.location,
    plant.supplierName,
    ...plant.labels,
    ...plant.careInstructions,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function PlantImagesRow({
  images,
  name,
  size = "md",
}: {
  images: string[];
  name: string;
  size?: "sm" | "md";
}) {
  const locale = useLocale();

  if (images.length === 0) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-500 ${
          size === "sm" ? "h-14 w-14" : "min-h-[5rem] w-full"
        }`}
      >
        {t(locale, "admin.plants.noImage")}
      </div>
    );
  }

  const thumbClass =
    size === "sm"
      ? "h-14 w-14 shrink-0 rounded-xl object-cover ring-1 ring-slate-200"
      : "h-28 w-full max-w-[8rem] rounded-xl object-cover ring-1 ring-slate-200 sm:h-32";

  return (
    <div className={`flex flex-wrap gap-2 ${size === "md" ? "mb-4" : ""}`}>
      {images.map((src) => (
        <img key={src} src={src} alt={name} className={thumbClass} />
      ))}
    </div>
  );
}

const inputClassName =
  "mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900";
const labelClassName = "text-xs font-medium text-slate-500";

function PlantFieldsForm({
  draft,
  onChange,
  idReadOnly,
}: {
  draft: PlantDraft;
  onChange: (next: PlantDraft) => void;
  idReadOnly?: boolean;
}) {
  const locale = useLocale();

  function patch(partial: Partial<PlantDraft>) {
    onChange({ ...draft, ...partial });
  }

  const previewImages = arrayFromLines(draft.imagesText);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <span className={labelClassName}>{t(locale, "admin.plants.images")}</span>
          <div className="mt-1">
            <PlantImagePicker
              images={previewImages}
              plantName={draft.name || t(locale, "admin.plants.defaultName")}
              onChange={(urls) => patch({ imagesText: linesFromArray(urls) })}
            />
          </div>
        </div>
        {idReadOnly ? (
          <label className="block sm:col-span-2">
            <span className={labelClassName}>{t(locale, "admin.plants.id")}</span>
            <input
              className={inputClassName}
              value={draft.id}
              readOnly
              disabled
              autoComplete="off"
            />
          </label>
        ) : null}
        <label className="block sm:col-span-2">
          <span className={labelClassName}>{t(locale, "admin.common.name")}</span>
          <input
            className={inputClassName}
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClassName}>{t(locale, "admin.plants.nameHe")}</span>
          <input
            className={inputClassName}
            value={draft.nameHe}
            onChange={(e) => patch({ nameHe: e.target.value })}
            dir="rtl"
          />
        </label>
        <label className="block">
          <span className={labelClassName}>{t(locale, "admin.plants.familyOptional")}</span>
          <input
            className={inputClassName}
            value={draft.family}
            onChange={(e) => patch({ family: e.target.value })}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClassName}>{t(locale, "admin.plants.subtitle")}</span>
          <input
            className={inputClassName}
            value={draft.subtitle}
            onChange={(e) => patch({ subtitle: e.target.value })}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClassName}>{t(locale, "admin.plants.subtitleHe")}</span>
          <input
            className={inputClassName}
            value={draft.subtitleHe}
            onChange={(e) => patch({ subtitleHe: e.target.value })}
            dir="rtl"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClassName}>{t(locale, "admin.plants.description")}</span>
          <textarea
            className={`${inputClassName} min-h-[4.5rem]`}
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClassName}>{t(locale, "admin.plants.descriptionHe")}</span>
          <textarea
            className={`${inputClassName} min-h-[4.5rem]`}
            value={draft.descriptionHe}
            onChange={(e) => patch({ descriptionHe: e.target.value })}
            dir="rtl"
          />
        </label>
        <label className="block">
          <span className={labelClassName}>{t(locale, "admin.common.price")}</span>
          <input
            className={inputClassName}
            type="number"
            min={0}
            step={1}
            value={draft.price}
            onChange={(e) => patch({ price: e.target.value })}
          />
        </label>
        <label className="block">
          <span className={labelClassName}>{t(locale, "admin.plants.currency")}</span>
          <select
            className={inputClassName}
            value={draft.currency}
            onChange={(e) => patch({ currency: e.target.value as PlantProduct["currency"] })}
          >
            {CURRENCY_OPTIONS.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClassName}>{t(locale, "admin.plants.labelsHint")}</span>
          <textarea
            className={`${inputClassName} min-h-[4rem]`}
            value={draft.labelsText}
            onChange={(e) => patch({ labelsText: e.target.value })}
          />
        </label>
        <label className="block">
          <span className={labelClassName}>{t(locale, "plant.info.light")}</span>
          <select
            className={inputClassName}
            value={draft.light}
            onChange={(e) => patch({ light: e.target.value as PlantProduct["light"] })}
          >
            {LIGHT_OPTIONS.map((light) => (
              <option key={light} value={light}>
                {lightLabel(locale, light)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClassName}>{t(locale, "plant.info.water")}</span>
          <input
            className={inputClassName}
            value={draft.water}
            onChange={(e) => patch({ water: e.target.value })}
          />
        </label>
        <label className="block">
          <span className={labelClassName}>{t(locale, "admin.plants.waterHe")}</span>
          <input
            className={inputClassName}
            value={draft.waterHe}
            onChange={(e) => patch({ waterHe: e.target.value })}
            dir="rtl"
          />
        </label>
        <label className="block">
          <span className={labelClassName}>{t(locale, "admin.plants.difficulty")}</span>
          <select
            className={inputClassName}
            value={draft.difficulty}
            onChange={(e) => patch({ difficulty: e.target.value as PlantProduct["difficulty"] })}
          >
            {DIFFICULTY_OPTIONS.map((difficulty) => (
              <option key={difficulty} value={difficulty}>
                {careLabel(locale, difficulty)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClassName}>{t(locale, "admin.plants.averageSizeOptional")}</span>
          <select
            className={inputClassName}
            value={draft.averageSize}
            onChange={(e) =>
              patch({ averageSize: e.target.value as PlantDraft["averageSize"] })
            }
          >
            <option value="">—</option>
            {SIZE_VALUES.map((size) => (
              <option key={size} value={size}>
                {sizeLabel(locale, size)}
              </option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClassName}>{t(locale, "admin.common.location")}</span>
          <input
            className={inputClassName}
            value={draft.location}
            onChange={(e) => patch({ location: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-2 sm:col-span-2">
          <input
            type="checkbox"
            checked={draft.petFriendly}
            onChange={(e) => patch({ petFriendly: e.target.checked })}
            className={adminCheckboxClassName}
          />
          <span className="text-sm text-slate-800">{t(locale, "admin.plants.petFriendly")}</span>
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClassName}>{t(locale, "admin.plants.careInstructionsHint")}</span>
          <textarea
            className={`${inputClassName} min-h-[5rem]`}
            value={draft.careInstructionsText}
            onChange={(e) => patch({ careInstructionsText: e.target.value })}
          />
        </label>
        <label className="block">
          <span className={labelClassName}>{t(locale, "admin.plants.supplierNameOptional")}</span>
          <input
            className={inputClassName}
            value={draft.supplierName}
            onChange={(e) => patch({ supplierName: e.target.value })}
          />
        </label>
        <label className="block">
          <span className={labelClassName}>{t(locale, "admin.plants.baseSupplierPriceOptional")}</span>
          <input
            className={inputClassName}
            type="number"
            min={0}
            step={0.01}
            value={draft.baseSupplierPrice}
            onChange={(e) => patch({ baseSupplierPrice: e.target.value })}
          />
        </label>
      </div>
    </div>
  );
}

function PlantDetailView({ plant }: { plant: PlantProduct }) {
  const locale = useLocale();

  return (
    <div>
      <PlantImagesRow images={plant.images} name={plant.name} />
      <dl className="grid gap-2 text-sm">
      <div className="flex flex-wrap gap-x-2">
        <dt className="font-medium text-slate-500">{t(locale, "admin.common.name")}</dt>
        <dd className="text-slate-900">{plant.name}</dd>
      </div>
      {plant.nameHe ? (
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">{t(locale, "admin.plants.nameHe")}</dt>
          <dd className="text-slate-900" dir="rtl">
            {plant.nameHe}
          </dd>
        </div>
      ) : null}
      {plant.family ? (
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">{t(locale, "admin.plants.family")}</dt>
          <dd className="text-slate-900">{plant.family}</dd>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-x-2">
        <dt className="font-medium text-slate-500">{t(locale, "admin.plants.subtitle")}</dt>
        <dd className="text-slate-900">{plant.subtitle}</dd>
      </div>
      {plant.subtitleHe ? (
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">{t(locale, "admin.plants.subtitleHe")}</dt>
          <dd className="text-slate-900" dir="rtl">
            {plant.subtitleHe}
          </dd>
        </div>
      ) : null}
      <div>
        <dt className="font-medium text-slate-500">{t(locale, "admin.plants.description")}</dt>
        <dd className="mt-0.5 text-slate-900">{plant.description}</dd>
      </div>
      {plant.descriptionHe ? (
        <div>
          <dt className="font-medium text-slate-500">{t(locale, "admin.plants.descriptionHe")}</dt>
          <dd className="mt-0.5 text-slate-900" dir="rtl">
            {plant.descriptionHe}
          </dd>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-x-2">
        <dt className="font-medium text-slate-500">{t(locale, "admin.common.price")}</dt>
        <dd className="text-slate-900">{formatPrice(plant.price, plant.currency, locale)}</dd>
      </div>
      <div>
        <dt className="font-medium text-slate-500">{t(locale, "admin.plants.labels")}</dt>
        <dd className="mt-0.5 text-slate-900">{plant.labels.join(" · ")}</dd>
      </div>
      <div className="flex flex-wrap gap-x-2">
        <dt className="font-medium text-slate-500">{t(locale, "plant.info.light")}</dt>
        <dd className="text-slate-900">{lightLabel(locale, plant.light)}</dd>
      </div>
      <div className="flex flex-wrap gap-x-2">
        <dt className="font-medium text-slate-500">{t(locale, "plant.info.water")}</dt>
        <dd className="text-slate-900">{plant.water}</dd>
      </div>
      {plant.waterHe ? (
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">{t(locale, "admin.plants.waterHe")}</dt>
          <dd className="text-slate-900" dir="rtl">
            {plant.waterHe}
          </dd>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-x-2">
        <dt className="font-medium text-slate-500">{t(locale, "admin.plants.difficulty")}</dt>
        <dd className="text-slate-900">{careLabel(locale, plant.difficulty)}</dd>
      </div>
      {plant.averageSize ? (
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">{t(locale, "admin.plants.averageSize")}</dt>
          <dd className="text-slate-900">{sizeLabel(locale, plant.averageSize)}</dd>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-x-2">
        <dt className="font-medium text-slate-500">{t(locale, "admin.common.location")}</dt>
        <dd className="text-slate-900">{plant.location}</dd>
      </div>
      <div className="flex flex-wrap gap-x-2">
        <dt className="font-medium text-slate-500">{t(locale, "admin.plants.petFriendly")}</dt>
        <dd className="text-slate-900">{yesNoLabel(locale, plant.petFriendly)}</dd>
      </div>
      <div>
        <dt className="font-medium text-slate-500">{t(locale, "admin.plants.careInstructions")}</dt>
        <dd className="mt-0.5">
          <ul className="list-inside list-disc text-slate-900">
            {plant.careInstructions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </dd>
      </div>
      {plant.supplierName ? (
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">{t(locale, "admin.plants.supplier")}</dt>
          <dd className="text-slate-900">{plant.supplierName}</dd>
        </div>
      ) : null}
      {typeof plant.baseSupplierPrice === "number" ? (
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">{t(locale, "admin.plants.baseSupplierPrice")}</dt>
          <dd className="text-slate-900">{plant.baseSupplierPrice}</dd>
        </div>
      ) : null}
      {plant.createdAt ? (
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">{t(locale, "admin.common.createdAt")}</dt>
          <dd className="font-mono text-xs text-slate-900">{plant.createdAt}</dd>
        </div>
      ) : null}
    </dl>
    </div>
  );
}

function AdminPlantCard({
  plant,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaved,
  onDeleted,
}: {
  plant: PlantProduct;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaved: (plant: PlantProduct) => void;
  onDeleted: (plantId: string) => void;
}) {
  const locale = useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(() => plantToDraft(plant));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditing) setDraft(plantToDraft(plant));
  }, [plant, isEditing]);

  useEffect(() => {
    if (isEditing) setIsOpen(true);
  }, [isEditing]);

  async function handleSave() {
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(routes.api.plant(plant.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftToPayload(draft)),
      });
      const data = (await res.json().catch(() => ({}))) as PlantsApiResponse;
      if (!res.ok) {
        setSaveError(displayApiError(locale, data.error, "admin.plants.saveFailed"));
        return;
      }
      if (data.plant) onSaved(data.plant);
    } catch {
      setSaveError(t(locale, "common.networkError"));
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmDelete() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch(routes.api.plant(plant.id), { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as PlantsApiResponse;
      if (!res.ok) {
        setDeleteError(displayApiError(locale, data.error, "admin.plants.deleteFailed"));
        return;
      }
      setDeleteOpen(false);
      onDeleted(plant.id);
    } catch {
      setDeleteError(t(locale, "common.networkError"));
    } finally {
      setDeleteBusy(false);
    }
  }

  const headerImage = plant.images[0];

  return (
    <article className="overflow-hidden rounded-3xl bg-white shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
      <div className="flex items-stretch" id="plant-card">
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50/80"
          aria-expanded={isOpen}
        >
          {headerImage ? (
            <img
              src={headerImage}
              alt=""
              className="h-14 w-14 shrink-0 rounded-xl object-cover ring-1 ring-slate-200"
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[10px] text-slate-500">
              —
            </div>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold text-emerald-950">
              {plant.name}
            </span>
            <span className="mt-0.5 block truncate text-sm text-slate-600">{plant.subtitle}</span>
            <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{formatPrice(plant.price, plant.currency, locale)}</span>
            </span>
          </span>
          <IconChevron className="h-5 w-5 shrink-0 text-slate-500" open={isOpen} />
        </button>
        {!isEditing ? (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteError(null);
                setDeleteOpen(true);
              }}
              className="flex w-12 shrink-0 items-center justify-center text-slate-500 transition hover:bg-slate-50 hover:text-red-700"
              aria-label={t(locale, "admin.plants.deleteAria")}
            >
              <IconTrash className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onStartEdit();
              }}
              className="flex w-12 shrink-0 items-center justify-center text-slate-700 transition hover:bg-slate-50"
              aria-label={t(locale, "admin.plants.editAria", { name: plant.name })}
            >
              <IconPencil className="h-5 w-5" />
            </button>
          </>
        ) : null}
      </div>

      {isOpen ? (
        <div className="border-t border-slate-100 px-4 pb-4 pt-4">
          {isEditing ? (
            <>
              <PlantFieldsForm draft={draft} onChange={setDraft} idReadOnly />
              {saveError ? <p className="mt-3 text-sm text-red-700">{saveError}</p> : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={isSaving}
                  className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50"
                >
                  {isSaving ? t(locale, "admin.shared.saving") : t(locale, "admin.shared.save")}
                </button>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  disabled={isSaving}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  {t(locale, "admin.shared.cancel")}
                </button>
              </div>
            </>
          ) : (
            <PlantDetailView plant={plant} />
          )}
        </div>
      ) : null}

      <AdminConfirmDialog
        open={deleteOpen}
        title={t(locale, "admin.plants.deleteTitle")}
        message={t(locale, "admin.plants.deleteMessage", { name: plant.name })}
        confirmLabel={t(locale, "admin.plants.deleteConfirm")}
        destructive
        busy={deleteBusy}
        error={deleteError}
        onCancel={() => {
          if (!deleteBusy) setDeleteOpen(false);
        }}
        onConfirm={() => void confirmDelete()}
      />
    </article>
  );
}

export function AdminPlantsManager({
  inventoryType,
}: {
  inventoryType: InventoryType;
}) {
  const locale = useLocale();
  const isFlowers = inventoryType === "flowers";
  const titleKey = isFlowers ? "admin.flowers.title" : "admin.plants.title";
  const newKey = isFlowers ? "admin.flowers.new" : "admin.plants.new";
  const createKey = isFlowers ? "admin.flowers.create" : "admin.plants.create";
  const createAriaKey = isFlowers ? "admin.flowers.createAria" : "admin.plants.createAria";
  const closeCreateAriaKey = isFlowers
    ? "admin.flowers.closeCreateAria"
    : "admin.plants.closeCreateAria";
  const searchAriaKey = isFlowers ? "admin.flowers.searchAria" : "admin.plants.searchAria";
  const searchPlaceholderKey = isFlowers
    ? "admin.flowers.searchPlaceholder"
    : "admin.plants.searchPlaceholder";
  const loadingKey = isFlowers ? "admin.flowers.loading" : "admin.plants.loading";
  const emptyKey = isFlowers ? "admin.flowers.empty" : "admin.plants.empty";
  const noMatchKey = isFlowers ? "admin.flowers.noMatch" : "admin.plants.noMatch";
  const loadFailedKey = isFlowers ? "admin.flowers.loadFailed" : "admin.plants.loadFailed";
  const loadNetworkKey = isFlowers
    ? "admin.flowers.loadNetworkError"
    : "admin.plants.loadNetworkError";
  const createFailedKey = isFlowers
    ? "admin.flowers.createFailed"
    : "admin.plants.createFailed";
  const [plants, setPlants] = useState<PlantProduct[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createDraft, setCreateDraft] = useState(emptyDraft);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredPlants = useMemo(
    () => plants.filter((plant) => plantMatchesSearch(plant, searchQuery)),
    [plants, searchQuery],
  );

  const loadPlants = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `${routes.api.plants()}?inventoryType=${inventoryType}`,
        { cache: "no-store", signal },
      );
      const data = (await res.json().catch(() => ({}))) as PlantsApiResponse;
      if (signal?.aborted) return;
      if (!res.ok) {
        setLoadError(displayApiError(locale, data.error, loadFailedKey));
        setPlants([]);
        return;
      }
      setPlants(data.plants ?? []);
    } catch {
      if (signal?.aborted) return;
      setLoadError(t(locale, loadNetworkKey));
      setPlants([]);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [inventoryType, locale, loadFailedKey, loadNetworkKey]);

  useEffect(() => {
    const controller = new AbortController();
    void loadPlants(controller.signal);
    return () => controller.abort();
  }, [loadPlants]);

  async function handleCreate() {
    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(routes.api.plants(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draftToPayload(createDraft, { omitId: true }),
          inventoryType,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as PlantsApiResponse;
      if (!res.ok) {
        setCreateError(displayApiError(locale, data.error, createFailedKey));
        return;
      }
      setShowCreate(false);
      setCreateDraft(emptyDraft());
      await loadPlants();
    } catch {
      setCreateError(t(locale, "common.networkError"));
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
            {t(locale, "admin.brand")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-emerald-950">
            {t(locale, titleKey)}
          </h1>
        </div>
        <div className="flex items-center gap-2">
           <Link
            href={routes.admin.products()}
            className="text-sm font-medium text-emerald-700 underline underline-offset-2"
          >
            {t(locale, "admin.products.title")}
          </Link>
           <Link
            href={routes.admin.index()}
            className="text-sm font-medium text-emerald-700 underline underline-offset-2"
          >
            {t(locale, "admin.common.admin")}
          </Link>
          <button
            type="button"
            onClick={() => {
              setShowCreate((open) => !open);
              setCreateError(null);
              if (showCreate) setCreateDraft(emptyDraft());
            }}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-700 text-white shadow-sm transition hover:bg-emerald-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
            aria-expanded={showCreate}
            aria-label={
              showCreate
                ? t(locale, closeCreateAriaKey)
                : t(locale, createAriaKey)
            }
          >
            <IconPlus className="h-6 w-6" />
          </button>
         
        </div>
      </div>

      {showCreate ? (
        <section className="mb-6 rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
          <h2 className="mb-4 text-base font-semibold text-emerald-950">
            {t(locale, newKey)}
          </h2>
          <PlantFieldsForm draft={createDraft} onChange={setCreateDraft} />
          {createError ? <p className="mt-3 text-sm text-red-700">{createError}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={isCreating}
              className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50"
            >
              {isCreating ? t(locale, "admin.common.creating") : t(locale, createKey)}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                setCreateDraft(emptyDraft());
                setCreateError(null);
              }}
              disabled={isCreating}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {t(locale, "admin.shared.cancel")}
            </button>
          </div>
        </section>
      ) : null}

      {!isLoading && !loadError && plants.length > 0 ? (
        <label className="mb-4 block">
          <span className="sr-only">{t(locale, searchAriaKey)}</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t(locale, searchPlaceholderKey)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
          />
        </label>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-slate-600">{t(locale, loadingKey)}</p>
      ) : loadError ? (
        <p className="text-sm text-red-700">{loadError}</p>
      ) : plants.length === 0 ? (
        <p className="rounded-2xl bg-white p-5 text-sm text-slate-600">
          {t(locale, emptyKey)}
        </p>
      ) : filteredPlants.length === 0 ? (
        <p className="rounded-2xl bg-white p-5 text-sm text-slate-600">
          {t(locale, noMatchKey, { query: searchQuery.trim() })}
        </p>
      ) : (
        <ul className="space-y-3">
          {filteredPlants.map((plant) => (
            <li key={plant.id}>
              <AdminPlantCard
                plant={plant}
                isEditing={editingId === plant.id}
                onStartEdit={() => {
                  setEditingId(plant.id);
                  setShowCreate(false);
                }}
                onCancelEdit={() => setEditingId(null)}
                onSaved={(updated) => {
                  setPlants((prev) =>
                    prev.map((item) => (item.id === updated.id ? updated : item)),
                  );
                  setEditingId(null);
                }}
                onDeleted={(plantId) => {
                  setPlants((prev) => prev.filter((item) => item.id !== plantId));
                  if (editingId === plantId) setEditingId(null);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
