"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PlantImagePicker } from "@/components/admin/PlantImagePicker";
import { formatPrice } from "@/lib/mockPlants";
import { routes } from "@/lib/routes";
import type { PlantProduct } from "@/lib/types";

type PlantsApiResponse = {
  plants?: PlantProduct[];
  plant?: PlantProduct;
  error?: string;
};

type PlantDraft = {
  id: string;
  name: string;
  family: string;
  subtitle: string;
  description: string;
  price: string;
  currency: PlantProduct["currency"];
  imagesText: string;
  labelsText: string;
  light: PlantProduct["light"];
  water: string;
  averageSize: PlantProduct["averageSize"] | "";
  maintenanceConditions: string;
  supplierName: string;
  baseSupplierPrice: string;
  difficulty: PlantProduct["difficulty"];
  location: string;
  petFriendly: boolean;
  careInstructionsText: string;
  commercialCopy: string;
};

const LIGHT_OPTIONS: PlantProduct["light"][] = [
  "Low light",
  "Indirect bright light",
  "Full sun",
];

const DIFFICULTY_OPTIONS: PlantProduct["difficulty"][] = ["Easy", "Moderate", "Advanced"];

const CURRENCY_OPTIONS: PlantProduct["currency"][] = ["ILS", "USD", "EUR"];

const SIZE_OPTIONS: NonNullable<PlantProduct["averageSize"]>[] = ["small", "medium", "large"];

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
    family: plant.family ?? "",
    subtitle: plant.subtitle,
    description: plant.description,
    price: String(plant.price),
    currency: plant.currency,
    imagesText: linesFromArray(plant.images),
    labelsText: linesFromArray(plant.labels),
    light: plant.light,
    water: plant.water,
    averageSize: plant.averageSize ?? "",
    maintenanceConditions: plant.maintenanceConditions ?? "",
    supplierName: plant.supplierName ?? "",
    baseSupplierPrice:
      typeof plant.baseSupplierPrice === "number" ? String(plant.baseSupplierPrice) : "",
    difficulty: plant.difficulty,
    location: plant.location,
    petFriendly: plant.petFriendly,
    careInstructionsText: linesFromArray(plant.careInstructions),
    commercialCopy: plant.commercialCopy,
  };
}

function emptyDraft(): PlantDraft {
  return {
    id: "",
    name: "",
    family: "",
    subtitle: "",
    description: "",
    price: "",
    currency: "ILS",
    imagesText: "",
    labelsText: "",
    light: "Indirect bright light",
    water: "",
    averageSize: "",
    maintenanceConditions: "",
    supplierName: "",
    baseSupplierPrice: "",
    difficulty: "Easy",
    location: "",
    petFriendly: false,
    careInstructionsText: "",
    commercialCopy: "",
  };
}

function draftToPayload(draft: PlantDraft, options?: { omitId?: boolean }): Record<string, unknown> {
  const price = Number(draft.price);
  const baseSupplierPrice =
    draft.baseSupplierPrice.trim() === "" ? undefined : Number(draft.baseSupplierPrice);

  return {
    ...(options?.omitId ? {} : { id: draft.id.trim() }),
    name: draft.name.trim(),
    ...(draft.family.trim() ? { family: draft.family.trim() } : {}),
    subtitle: draft.subtitle.trim(),
    description: draft.description.trim(),
    price,
    currency: draft.currency,
    images: arrayFromLines(draft.imagesText),
    labels: arrayFromLines(draft.labelsText),
    light: draft.light,
    water: draft.water.trim(),
    ...(draft.averageSize ? { averageSize: draft.averageSize } : {}),
    ...(draft.maintenanceConditions.trim()
      ? { maintenanceConditions: draft.maintenanceConditions.trim() }
      : {}),
    ...(draft.supplierName.trim() ? { supplierName: draft.supplierName.trim() } : {}),
    ...(baseSupplierPrice !== undefined && Number.isFinite(baseSupplierPrice)
      ? { baseSupplierPrice }
      : {}),
    difficulty: draft.difficulty,
    location: draft.location.trim(),
    petFriendly: draft.petFriendly,
    careInstructions: arrayFromLines(draft.careInstructionsText),
    commercialCopy: draft.commercialCopy.trim(),
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
    plant.family,
    plant.subtitle,
    plant.description,
    plant.currency,
    String(plant.price),
    plant.light,
    plant.water,
    plant.difficulty,
    plant.location,
    plant.commercialCopy,
    plant.maintenanceConditions,
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
  if (images.length === 0) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-500 ${
          size === "sm" ? "h-14 w-14" : "min-h-[5rem] w-full"
        }`}
      >
        No image
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
  function patch(partial: Partial<PlantDraft>) {
    onChange({ ...draft, ...partial });
  }

  const previewImages = arrayFromLines(draft.imagesText);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <span className={labelClassName}>Images</span>
          <div className="mt-1">
            <PlantImagePicker
              images={previewImages}
              plantName={draft.name || "Plant"}
              onChange={(urls) => patch({ imagesText: linesFromArray(urls) })}
            />
          </div>
        </div>
        {idReadOnly ? (
          <label className="block sm:col-span-2">
            <span className={labelClassName}>ID</span>
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
          <span className={labelClassName}>Name</span>
          <input
            className={inputClassName}
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>
        <label className="block">
          <span className={labelClassName}>Family (optional)</span>
          <input
            className={inputClassName}
            value={draft.family}
            onChange={(e) => patch({ family: e.target.value })}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClassName}>Subtitle</span>
          <input
            className={inputClassName}
            value={draft.subtitle}
            onChange={(e) => patch({ subtitle: e.target.value })}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClassName}>Description</span>
          <textarea
            className={`${inputClassName} min-h-[4.5rem]`}
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </label>
        <label className="block">
          <span className={labelClassName}>Price</span>
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
          <span className={labelClassName}>Currency</span>
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
          <span className={labelClassName}>Labels (one per line)</span>
          <textarea
            className={`${inputClassName} min-h-[4rem]`}
            value={draft.labelsText}
            onChange={(e) => patch({ labelsText: e.target.value })}
          />
        </label>
        <label className="block">
          <span className={labelClassName}>Light</span>
          <select
            className={inputClassName}
            value={draft.light}
            onChange={(e) => patch({ light: e.target.value as PlantProduct["light"] })}
          >
            {LIGHT_OPTIONS.map((light) => (
              <option key={light} value={light}>
                {light}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClassName}>Water</span>
          <input
            className={inputClassName}
            value={draft.water}
            onChange={(e) => patch({ water: e.target.value })}
          />
        </label>
        <label className="block">
          <span className={labelClassName}>Difficulty</span>
          <select
            className={inputClassName}
            value={draft.difficulty}
            onChange={(e) => patch({ difficulty: e.target.value as PlantProduct["difficulty"] })}
          >
            {DIFFICULTY_OPTIONS.map((difficulty) => (
              <option key={difficulty} value={difficulty}>
                {difficulty}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClassName}>Average size (optional)</span>
          <select
            className={inputClassName}
            value={draft.averageSize}
            onChange={(e) =>
              patch({ averageSize: e.target.value as PlantDraft["averageSize"] })
            }
          >
            <option value="">—</option>
            {SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClassName}>Location</span>
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
            className="h-4 w-4 rounded border-slate-300 text-emerald-700"
          />
          <span className="text-sm text-slate-800">Pet friendly</span>
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClassName}>Care instructions (one per line)</span>
          <textarea
            className={`${inputClassName} min-h-[5rem]`}
            value={draft.careInstructionsText}
            onChange={(e) => patch({ careInstructionsText: e.target.value })}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClassName}>Commercial copy</span>
          <textarea
            className={`${inputClassName} min-h-[4rem]`}
            value={draft.commercialCopy}
            onChange={(e) => patch({ commercialCopy: e.target.value })}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClassName}>Maintenance conditions (optional)</span>
          <input
            className={inputClassName}
            value={draft.maintenanceConditions}
            onChange={(e) => patch({ maintenanceConditions: e.target.value })}
          />
        </label>
        <label className="block">
          <span className={labelClassName}>Supplier name (optional)</span>
          <input
            className={inputClassName}
            value={draft.supplierName}
            onChange={(e) => patch({ supplierName: e.target.value })}
          />
        </label>
        <label className="block">
          <span className={labelClassName}>Base supplier price (optional)</span>
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
  return (
    <div>
      <PlantImagesRow images={plant.images} name={plant.name} />
      <dl className="grid gap-2 text-sm">
      <div className="flex flex-wrap gap-x-2">
        <dt className="font-medium text-slate-500">Name</dt>
        <dd className="text-slate-900">{plant.name}</dd>
      </div>
      {plant.family ? (
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">Family</dt>
          <dd className="text-slate-900">{plant.family}</dd>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-x-2">
        <dt className="font-medium text-slate-500">Subtitle</dt>
        <dd className="text-slate-900">{plant.subtitle}</dd>
      </div>
      <div>
        <dt className="font-medium text-slate-500">Description</dt>
        <dd className="mt-0.5 text-slate-900">{plant.description}</dd>
      </div>
      <div className="flex flex-wrap gap-x-2">
        <dt className="font-medium text-slate-500">Price</dt>
        <dd className="text-slate-900">{formatPrice(plant.price, plant.currency)}</dd>
      </div>
      <div>
        <dt className="font-medium text-slate-500">Labels</dt>
        <dd className="mt-0.5 text-slate-900">{plant.labels.join(" · ")}</dd>
      </div>
      <div className="flex flex-wrap gap-x-2">
        <dt className="font-medium text-slate-500">Light</dt>
        <dd className="text-slate-900">{plant.light}</dd>
      </div>
      <div className="flex flex-wrap gap-x-2">
        <dt className="font-medium text-slate-500">Water</dt>
        <dd className="text-slate-900">{plant.water}</dd>
      </div>
      <div className="flex flex-wrap gap-x-2">
        <dt className="font-medium text-slate-500">Difficulty</dt>
        <dd className="text-slate-900">{plant.difficulty}</dd>
      </div>
      {plant.averageSize ? (
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">Average size</dt>
          <dd className="text-slate-900">{plant.averageSize}</dd>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-x-2">
        <dt className="font-medium text-slate-500">Location</dt>
        <dd className="text-slate-900">{plant.location}</dd>
      </div>
      <div className="flex flex-wrap gap-x-2">
        <dt className="font-medium text-slate-500">Pet friendly</dt>
        <dd className="text-slate-900">{plant.petFriendly ? "Yes" : "No"}</dd>
      </div>
      <div>
        <dt className="font-medium text-slate-500">Care instructions</dt>
        <dd className="mt-0.5">
          <ul className="list-inside list-disc text-slate-900">
            {plant.careInstructions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </dd>
      </div>
      <div>
        <dt className="font-medium text-slate-500">Commercial copy</dt>
        <dd className="mt-0.5 text-slate-900">{plant.commercialCopy}</dd>
      </div>
      {plant.maintenanceConditions ? (
        <div>
          <dt className="font-medium text-slate-500">Maintenance</dt>
          <dd className="mt-0.5 text-slate-900">{plant.maintenanceConditions}</dd>
        </div>
      ) : null}
      {plant.supplierName ? (
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">Supplier</dt>
          <dd className="text-slate-900">{plant.supplierName}</dd>
        </div>
      ) : null}
      {typeof plant.baseSupplierPrice === "number" ? (
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">Base supplier price</dt>
          <dd className="text-slate-900">{plant.baseSupplierPrice}</dd>
        </div>
      ) : null}
      {plant.createdAt ? (
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">Created at</dt>
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
}: {
  plant: PlantProduct;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaved: (plant: PlantProduct) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(() => plantToDraft(plant));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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
        setSaveError(data.error ?? "Could not save plant");
        return;
      }
      if (data.plant) onSaved(data.plant);
    } catch {
      setSaveError("Network error. Try again.");
    } finally {
      setIsSaving(false);
    }
  }

  const headerImage = plant.images[0];

  return (
    <article className="overflow-hidden rounded-3xl bg-white shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
      <div className="flex items-stretch" id='plant-card'>
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
              <span>{formatPrice(plant.price, plant.currency)}</span>
            </span>
          </span>
          <IconChevron className="h-5 w-5 shrink-0 text-slate-500" open={isOpen} />
        </button>
        {!isEditing ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStartEdit();
            }}
            className="flex w-12 shrink-0 items-center justify-center text-slate-700 transition hover:bg-slate-50"
            aria-label={`Edit ${plant.name}`}
          >
            <IconPencil className="h-5 w-5" />
          </button>
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
                  {isSaving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  disabled={isSaving}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <PlantDetailView plant={plant} />
          )}
        </div>
      ) : null}
    </article>
  );
}

export function AdminPlantsManager() {
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
      const res = await fetch(routes.api.plants(), { cache: "no-store", signal });
      const data = (await res.json().catch(() => ({}))) as PlantsApiResponse;
      if (signal?.aborted) return;
      if (!res.ok) {
        setLoadError(data.error ?? "Could not load plants");
        setPlants([]);
        return;
      }
      setPlants(data.plants ?? []);
    } catch {
      if (signal?.aborted) return;
      setLoadError("Network error while loading plants");
      setPlants([]);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

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
        body: JSON.stringify(draftToPayload(createDraft, { omitId: true })),
      });
      const data = (await res.json().catch(() => ({}))) as PlantsApiResponse;
      if (!res.ok) {
        setCreateError(data.error ?? "Could not create plant");
        return;
      }
      setShowCreate(false);
      setCreateDraft(emptyDraft());
      await loadPlants();
    } catch {
      setCreateError("Network error. Try again.");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
            Urban Plant · Admin
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-emerald-950">Plants</h1>
        </div>
        <div className="flex items-center gap-2">
           <Link
            href={routes.admin.index()}
            className="text-sm font-medium text-emerald-700 underline underline-offset-2"
          >
            Admin
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
            aria-label={showCreate ? "Close create plant form" : "Create plant"}
          >
            <IconPlus className="h-6 w-6" />
          </button>
         
        </div>
      </div>

      <p className="mb-6 text-sm leading-relaxed text-slate-600">
        Catalog plants used across POS pages, offers, and orders. Changes are saved to{" "}
        <span className="font-mono text-slate-800">data/plants.json</span>.
      </p>

      {showCreate ? (
        <section className="mb-6 rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
          <h2 className="mb-4 text-base font-semibold text-emerald-950">New plant</h2>
          <PlantFieldsForm draft={createDraft} onChange={setCreateDraft} />
          {createError ? <p className="mt-3 text-sm text-red-700">{createError}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={isCreating}
              className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50"
            >
              {isCreating ? "Creating…" : "Create plant"}
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
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {!isLoading && !loadError && plants.length > 0 ? (
        <label className="mb-4 block">
          <span className="sr-only">Search plants</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, id, labels…"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
          />
        </label>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-slate-600">Loading plants…</p>
      ) : loadError ? (
        <p className="text-sm text-red-700">{loadError}</p>
      ) : plants.length === 0 ? (
        <p className="rounded-2xl bg-white p-5 text-sm text-slate-600">No plants in the catalog yet.</p>
      ) : filteredPlants.length === 0 ? (
        <p className="rounded-2xl bg-white p-5 text-sm text-slate-600">
          No plants match &ldquo;{searchQuery.trim()}&rdquo;.
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
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
