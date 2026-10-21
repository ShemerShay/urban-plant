"use client";

import { useCallback, useEffect, useState } from "react";

import { AdminConfirmDialog } from "@/components/admin/shared/AdminConfirmDialog";
import { useLocale } from "@/components/locale/LocaleProvider";
import { displayApiError } from "@/lib/displayLabels";
import { formatPrice } from "@/lib/mockPlants";
import { t } from "@/lib/messages";
import { isPlantSizeLabel, PLANT_SIZE_LABELS } from "@/lib/plantSizes";
import { routes } from "@/lib/routes";
import type { Locale } from "@/lib/locale";
import type { PlantProduct } from "@/lib/types";

type VariantRow = {
  id: string;
  plantId: string;
  sizeLabel?: string;
  nurseryPotDiameterCm?: number;
  catalogPrice?: number | null;
  quantity: number;
};

function variantLabel(variant: VariantRow, fallback: string): string {
  const size = variant.sizeLabel?.trim();
  const cm = variant.nurseryPotDiameterCm;
  if (size && cm != null) return `${size} (${cm} cm)`;
  if (size) return size;
  if (cm != null) return `${cm} cm`;
  return fallback;
}

function PlantSizeSelect({
  value,
  onChange,
  label,
  inputClassName,
  labelClassName,
  allowEmpty,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  inputClassName: string;
  labelClassName: string;
  allowEmpty?: boolean;
}) {
  return (
    <label>
      <span className={labelClassName}>{label}</span>
      <select className={inputClassName} value={value} onChange={(e) => onChange(e.target.value)}>
        {allowEmpty ? <option value="">—</option> : null}
        {PLANT_SIZE_LABELS.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>
    </label>
  );
}

type VariantsApiResponse = {
  variants?: VariantRow[];
  variant?: VariantRow;
  quantity?: number;
  error?: string;
  ok?: boolean;
};

function catalogPriceText(
  variant: VariantRow,
  plant: PlantProduct,
  locale: Locale,
): string {
  return typeof variant.catalogPrice === "number"
    ? formatPrice(variant.catalogPrice, plant.currency, locale)
    : "—";
}

export function AdminPlantVariantsPanel({ plant }: { plant: PlantProduct }) {
  const locale = useLocale();
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [sizeLabel, setSizeLabel] = useState("");
  const [diameter, setDiameter] = useState("");
  const [catalogPrice, setCatalogPrice] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSize, setEditSize] = useState("");
  const [editDiameter, setEditDiameter] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [adjustId, setAdjustId] = useState<string | null>(null);
  const [adjustDelta, setAdjustDelta] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [isAdjusting, setIsAdjusting] = useState(false);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadVariants = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(routes.api.plantVariants(plant.id), {
          cache: "no-store",
          signal,
        });
        const data = (await res.json().catch(() => ({}))) as VariantsApiResponse;
        if (signal?.aborted) return;
        if (!res.ok) {
          setLoadError(displayApiError(locale, data.error, "admin.plants.variants.loadFailed"));
          setVariants([]);
          return;
        }
        setVariants(data.variants ?? []);
      } catch {
        if (signal?.aborted) return;
        setLoadError(t(locale, "admin.plants.variants.loadNetworkError"));
        setVariants([]);
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [locale, plant.id],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadVariants(controller.signal);
    return () => controller.abort();
  }, [loadVariants]);

  function startEdit(variant: VariantRow) {
    setEditingId(variant.id);
    setEditSize(variant.sizeLabel ?? "");
    setEditDiameter(
      variant.nurseryPotDiameterCm != null ? String(variant.nurseryPotDiameterCm) : "",
    );
    setEditPrice(typeof variant.catalogPrice === "number" ? String(variant.catalogPrice) : "");
    setEditError(null);
    setAdjustId(null);
  }

  async function handleCreate() {
    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(routes.api.plantVariants(plant.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(sizeLabel.trim() ? { sizeLabel: sizeLabel.trim() } : {}),
          ...(diameter.trim() ? { nurseryPotDiameterCm: Number(diameter) } : {}),
          ...(catalogPrice.trim() ? { catalogPrice: Number(catalogPrice) } : { catalogPrice: null }),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as VariantsApiResponse;
      if (!res.ok) {
        setCreateError(displayApiError(locale, data.error, "admin.plants.variants.createFailed"));
        return;
      }
      setSizeLabel("");
      setDiameter("");
      setCatalogPrice("");
      await loadVariants();
    } catch {
      setCreateError(t(locale, "common.networkError"));
    } finally {
      setIsCreating(false);
    }
  }

  async function handleSaveEdit(variantId: string) {
    setIsSaving(true);
    setEditError(null);
    try {
      const res = await fetch(routes.api.plantVariant(plant.id, variantId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isPlantSizeLabel(editSize) ? { sizeLabel: editSize } : {}),
          nurseryPotDiameterCm: editDiameter.trim() ? Number(editDiameter) : null,
          catalogPrice: editPrice.trim() ? Number(editPrice) : null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as VariantsApiResponse;
      if (!res.ok) {
        setEditError(displayApiError(locale, data.error, "admin.plants.variants.saveFailed"));
        return;
      }
      setEditingId(null);
      await loadVariants();
    } catch {
      setEditError(t(locale, "common.networkError"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAdjust(variantId: string) {
    setIsAdjusting(true);
    setAdjustError(null);
    const delta = Number(adjustDelta);
    try {
      const res = await fetch(routes.api.plantVariantInventory(plant.id, variantId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta, note: adjustNote }),
      });
      const data = (await res.json().catch(() => ({}))) as VariantsApiResponse;
      if (!res.ok) {
        setAdjustError(displayApiError(locale, data.error, "admin.plants.variants.adjustFailed"));
        return;
      }
      setAdjustId(null);
      setAdjustDelta("");
      setAdjustNote("");
      await loadVariants();
    } catch {
      setAdjustError(t(locale, "common.networkError"));
    } finally {
      setIsAdjusting(false);
    }
  }

  async function confirmDelete() {
    if (!deleteId) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch(routes.api.plantVariant(plant.id, deleteId), { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as VariantsApiResponse;
      if (!res.ok) {
        setDeleteError(displayApiError(locale, data.error, "admin.plants.variants.deleteFailed"));
        return;
      }
      setDeleteId(null);
      await loadVariants();
    } catch {
      setDeleteError(t(locale, "common.networkError"));
    } finally {
      setDeleteBusy(false);
    }
  }

  const inputClassName =
    "mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900";
  const labelClassName = "text-xs font-medium text-slate-500";

  return (
    <section className="mt-5 border-t border-slate-100 pt-4">
      <h3 className="text-sm font-semibold text-emerald-950">
        {t(locale, "admin.plants.variants.title")}
      </h3>
      <p className="mt-1 text-xs text-slate-500">{t(locale, "admin.plants.variants.intro")}</p>

      {isLoading ? (
        <p className="mt-3 text-sm text-slate-600">{t(locale, "admin.plants.variants.loading")}</p>
      ) : loadError ? (
        <p className="mt-3 text-sm text-red-700">{loadError}</p>
      ) : variants.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">{t(locale, "admin.plants.variants.empty")}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {variants.map((variant) => (
            <li key={variant.id} className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
              {editingId === variant.id ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  {isPlantSizeLabel(variant.sizeLabel) ? (
                    <PlantSizeSelect
                      value={editSize}
                      onChange={setEditSize}
                      label={t(locale, "admin.plants.variants.sizeLabel")}
                      inputClassName={inputClassName}
                      labelClassName={labelClassName}
                    />
                  ) : (
                    <div>
                      <span className={labelClassName}>
                        {t(locale, "admin.plants.variants.sizeLabel")}
                      </span>
                      <p className="mt-1 text-sm text-slate-800">{variant.sizeLabel?.trim() || "—"}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {t(locale, "admin.plants.variants.legacyKept")}
                      </p>
                    </div>
                  )}
                  <label>
                    <span className={labelClassName}>{t(locale, "admin.plants.variants.diameter")}</span>
                    <input
                      className={inputClassName}
                      type="number"
                      min={0}
                      step={0.1}
                      value={editDiameter}
                      onChange={(e) => setEditDiameter(e.target.value)}
                    />
                  </label>
                  <label>
                    <span className={labelClassName}>{t(locale, "admin.plants.variants.catalogPrice")}</span>
                    <input
                      className={inputClassName}
                      type="number"
                      min={0}
                      step={0.01}
                      value={editPrice}
                      onChange={(e) => setEditPrice(e.target.value)}
                    />
                  </label>
                </div>
              ) : (
                <div className="text-sm text-slate-800">
                  <p className="font-medium text-emerald-950">
                    {variantLabel(variant, t(locale, "admin.plants.variants.sizeLabel"))}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {t(locale, "admin.plants.variants.catalogPrice")}:{" "}
                    {catalogPriceText(variant, plant, locale)}
                    {" · "}
                    {t(locale, "admin.plants.variants.quantity")}: {variant.quantity}
                  </p>
                </div>
              )}

              {editingId === variant.id && editError ? (
                <p className="mt-2 text-sm text-red-700">{editError}</p>
              ) : null}

              {adjustId === variant.id ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label>
                    <span className={labelClassName}>{t(locale, "admin.plants.variants.delta")}</span>
                    <input
                      className={inputClassName}
                      type="number"
                      step={1}
                      value={adjustDelta}
                      onChange={(e) => setAdjustDelta(e.target.value)}
                    />
                  </label>
                  <label>
                    <span className={labelClassName}>{t(locale, "admin.plants.variants.note")}</span>
                    <input
                      className={inputClassName}
                      value={adjustNote}
                      onChange={(e) => setAdjustNote(e.target.value)}
                      maxLength={200}
                    />
                  </label>
                  {adjustError ? <p className="text-sm text-red-700 sm:col-span-2">{adjustError}</p> : null}
                  <div className="flex flex-wrap gap-2 sm:col-span-2">
                    <button
                      type="button"
                      onClick={() => void handleAdjust(variant.id)}
                      disabled={isAdjusting}
                      className="rounded-xl bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {isAdjusting
                        ? t(locale, "admin.shared.saving")
                        : t(locale, "admin.plants.variants.applyAdjust")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAdjustId(null);
                        setAdjustError(null);
                      }}
                      disabled={isAdjusting}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800"
                    >
                      {t(locale, "admin.shared.cancel")}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                {editingId === variant.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleSaveEdit(variant.id)}
                      disabled={isSaving}
                      className="rounded-xl bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {isSaving ? t(locale, "admin.shared.saving") : t(locale, "admin.shared.save")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      disabled={isSaving}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800"
                    >
                      {t(locale, "admin.shared.cancel")}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => startEdit(variant)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800"
                    >
                      {t(locale, "admin.plants.variants.edit")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAdjustId(variant.id);
                        setAdjustDelta("");
                        setAdjustNote("");
                        setAdjustError(null);
                        setEditingId(null);
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800"
                    >
                      {t(locale, "admin.plants.variants.adjust")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteId(variant.id);
                      }}
                      className="rounded-xl border border-red-100 bg-white px-3 py-1.5 text-sm font-semibold text-red-700"
                    >
                      {t(locale, "admin.plants.variants.delete")}
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 rounded-2xl border border-dashed border-slate-200 p-3">
        <h4 className="text-sm font-medium text-emerald-950">
          {t(locale, "admin.plants.variants.new")}
        </h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <PlantSizeSelect
            value={sizeLabel}
            onChange={setSizeLabel}
            label={t(locale, "admin.plants.variants.sizeLabel")}
            inputClassName={inputClassName}
            labelClassName={labelClassName}
            allowEmpty
          />
          <label>
            <span className={labelClassName}>{t(locale, "admin.plants.variants.diameter")}</span>
            <input
              className={inputClassName}
              type="number"
              min={0}
              step={0.1}
              value={diameter}
              onChange={(e) => setDiameter(e.target.value)}
            />
          </label>
          <label>
            <span className={labelClassName}>{t(locale, "admin.plants.variants.catalogPrice")}</span>
            <input
              className={inputClassName}
              type="number"
              min={0}
              step={0.01}
              value={catalogPrice}
              onChange={(e) => setCatalogPrice(e.target.value)}
            />
          </label>
        </div>
        {createError ? <p className="mt-2 text-sm text-red-700">{createError}</p> : null}
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={isCreating || !isPlantSizeLabel(sizeLabel)}
          className="mt-3 rounded-xl bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {isCreating
            ? t(locale, "admin.common.creating")
            : t(locale, "admin.plants.variants.create")}
        </button>
      </div>

      <AdminConfirmDialog
        open={Boolean(deleteId)}
        title={t(locale, "admin.plants.variants.deleteTitle")}
        message={t(locale, "admin.plants.variants.deleteMessage")}
        confirmLabel={t(locale, "admin.plants.variants.deleteConfirm")}
        destructive
        busy={deleteBusy}
        error={deleteError}
        onCancel={() => {
          if (!deleteBusy) setDeleteId(null);
        }}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
