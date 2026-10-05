"use client";

import { useCallback, useEffect, useState } from "react";

import { AdminConfirmDialog } from "@/components/admin/shared/AdminConfirmDialog";
import { PlantImagePicker } from "@/components/admin/PlantImagePicker";
import { useLocale } from "@/components/locale/LocaleProvider";
import { formatCatalogPrice } from "@/lib/catalogPriceFormat";
import { displayApiError } from "@/lib/displayLabels";
import { t } from "@/lib/messages";
import { POT_SIZE_LABELS, type PotSizeLabel } from "@/lib/potSizes";
import { routes } from "@/lib/routes";

type PotVariantRow = {
  id: string;
  potId: string;
  sizeLabel: PotSizeLabel;
  color: string;
  colorHe?: string;
  catalogPrice: number;
};

type PotRow = {
  id: string;
  name: string;
  nameHe?: string;
  image?: string;
  variants: PotVariantRow[];
};

type ApiResponse = {
  pots?: PotRow[];
  pot?: PotRow;
  variant?: PotVariantRow;
  error?: string;
};

const inputClassName = "mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900";
const labelClassName = "text-xs font-medium text-slate-500";

export function AdminPotsManager() {
  const locale = useLocale();
  const [pots, setPots] = useState<PotRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [name, setName] = useState("");
  const [nameHe, setNameHe] = useState("");
  const [image, setImage] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editNameHe, setEditNameHe] = useState("");
  const [editImage, setEditImage] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [variantPotId, setVariantPotId] = useState<string | null>(null);
  const [variantSize, setVariantSize] = useState<PotSizeLabel>("S");
  const [variantColor, setVariantColor] = useState("");
  const [variantColorHe, setVariantColorHe] = useState("");
  const [variantPrice, setVariantPrice] = useState("");
  const [variantError, setVariantError] = useState<string | null>(null);
  const [isAddingVariant, setIsAddingVariant] = useState(false);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadPots = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(routes.api.pots(), { cache: "no-store", signal });
        const data = (await res.json().catch(() => ({}))) as ApiResponse;
        if (signal?.aborted) return;
        if (!res.ok) {
          setLoadError(displayApiError(locale, data.error, "admin.pots.loadFailed"));
          setPots([]);
          return;
        }
        setPots(data.pots ?? []);
      } catch {
        if (signal?.aborted) return;
        setLoadError(t(locale, "common.networkError"));
        setPots([]);
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [locale],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPots(controller.signal);
    return () => controller.abort();
  }, [loadPots]);

  async function handleCreate() {
    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(routes.api.pots(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          nameHe: nameHe.trim() || null,
          image: image.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok) {
        setCreateError(displayApiError(locale, data.error, "admin.pots.createFailed"));
        return;
      }
      setName("");
      setNameHe("");
      setImage("");
      await loadPots();
    } catch {
      setCreateError(t(locale, "common.networkError"));
    } finally {
      setIsCreating(false);
    }
  }

  function startEdit(pot: PotRow) {
    setEditingId(pot.id);
    setEditName(pot.name);
    setEditNameHe(pot.nameHe ?? "");
    setEditImage(pot.image ?? "");
    setEditError(null);
  }

  async function handleSave(potId: string) {
    setIsSaving(true);
    setEditError(null);
    try {
      const res = await fetch(routes.api.pot(potId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          nameHe: editNameHe.trim() || null,
          image: editImage.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok) {
        setEditError(displayApiError(locale, data.error, "admin.pots.saveFailed"));
        return;
      }
      setEditingId(null);
      await loadPots();
    } catch {
      setEditError(t(locale, "common.networkError"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAddVariant(potId: string) {
    setIsAddingVariant(true);
    setVariantError(null);
    try {
      const res = await fetch(routes.api.potVariants(potId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sizeLabel: variantSize,
          color: variantColor.trim(),
          colorHe: variantColorHe.trim() || null,
          catalogPrice: Number(variantPrice),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok) {
        setVariantError(displayApiError(locale, data.error, "admin.pots.saveFailed"));
        return;
      }
      setVariantColor("");
      setVariantColorHe("");
      setVariantPrice("");
      setVariantPotId(null);
      await loadPots();
    } catch {
      setVariantError(t(locale, "common.networkError"));
    } finally {
      setIsAddingVariant(false);
    }
  }

  async function handleDeleteVariant(potId: string, variantId: string) {
    setVariantError(null);
    try {
      const res = await fetch(routes.api.potVariant(potId, variantId), { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok) {
        setVariantError(displayApiError(locale, data.error, "admin.pots.deleteFailed"));
        return;
      }
      await loadPots();
    } catch {
      setVariantError(t(locale, "common.networkError"));
    }
  }

  async function confirmDelete() {
    if (!deleteId) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch(routes.api.pot(deleteId), { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok) {
        setDeleteError(displayApiError(locale, data.error, "admin.pots.deleteFailed"));
        return;
      }
      setDeleteId(null);
      await loadPots();
    } catch {
      setDeleteError(t(locale, "common.networkError"));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <section>
      <h1 className="text-2xl font-semibold text-emerald-950">{t(locale, "admin.pots.title")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{t(locale, "admin.pots.intro")}</p>

      <form
        className="mt-6 space-y-3 rounded-3xl bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.04)]"
        onSubmit={(event) => {
          event.preventDefault();
          void handleCreate();
        }}
      >
        <label className="block">
          <span className={labelClassName}>{t(locale, "admin.pots.name")}</span>
          <input className={inputClassName} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className={labelClassName}>{t(locale, "admin.pots.nameHe")}</span>
          <input className={inputClassName} value={nameHe} onChange={(e) => setNameHe(e.target.value)} />
        </label>
        <PlantImagePicker
          images={image ? [image] : []}
          onChange={(urls) => setImage(urls[urls.length - 1] ?? "")}
          plantName={name || t(locale, "admin.pots.title")}
        />
        {createError ? <p className="text-sm text-red-700">{createError}</p> : null}
        <button
          type="submit"
          disabled={isCreating}
          className="text-sm font-semibold text-emerald-800 disabled:opacity-60"
        >
          {t(locale, "admin.pots.create")}
        </button>
      </form>

      {isLoading ? (
        <p className="mt-6 text-sm text-slate-600">{t(locale, "admin.pots.loading")}</p>
      ) : loadError ? (
        <p className="mt-6 text-sm text-red-700">{loadError}</p>
      ) : pots.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">{t(locale, "admin.pots.empty")}</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {pots.map((pot) => (
            <li key={pot.id} className="rounded-3xl bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
              {editingId === pot.id ? (
                <div className="space-y-3">
                  <label className="block">
                    <span className={labelClassName}>{t(locale, "admin.pots.name")}</span>
                    <input className={inputClassName} value={editName} onChange={(e) => setEditName(e.target.value)} />
                  </label>
                  <label className="block">
                    <span className={labelClassName}>{t(locale, "admin.pots.nameHe")}</span>
                    <input
                      className={inputClassName}
                      value={editNameHe}
                      onChange={(e) => setEditNameHe(e.target.value)}
                    />
                  </label>
                  <PlantImagePicker
                    images={editImage ? [editImage] : []}
                    onChange={(urls) => setEditImage(urls[urls.length - 1] ?? "")}
                    plantName={editName}
                  />
                  {editError ? <p className="text-sm text-red-700">{editError}</p> : null}
                  <button
                    type="button"
                    disabled={isSaving}
                    className="text-sm font-semibold text-emerald-800"
                    onClick={() => void handleSave(pot.id)}
                  >
                    {t(locale, "admin.pots.save")}
                  </button>
                </div>
              ) : (
                <div>
                  <p className="font-medium text-emerald-950">{pot.name}</p>
                  {pot.nameHe ? <p className="text-sm text-slate-600">{pot.nameHe}</p> : null}
                  <div className="mt-2 flex gap-3">
                    <button type="button" className="text-sm text-emerald-800" onClick={() => startEdit(pot)}>
                      {t(locale, "admin.pots.edit")}
                    </button>
                    <button type="button" className="text-sm text-red-700" onClick={() => setDeleteId(pot.id)}>
                      {t(locale, "admin.pots.delete")}
                    </button>
                  </div>
                </div>
              )}

              <ul className="mt-4 space-y-2">
                {pot.variants.map((variant) => (
                  <li key={variant.id} className="flex items-center justify-between gap-3 text-sm text-slate-800">
                    <span>
                      {variant.sizeLabel} · {variant.color}
                      {variant.colorHe ? ` · ${variant.colorHe}` : ""} ·{" "}
                      {formatCatalogPrice(variant.catalogPrice, "ILS", locale)}
                    </span>
                    <button
                      type="button"
                      className="text-xs text-red-700"
                      onClick={() => void handleDeleteVariant(pot.id, variant.id)}
                    >
                      {t(locale, "admin.pots.delete")}
                    </button>
                  </li>
                ))}
              </ul>

              {variantPotId === pot.id ? (
                <div className="mt-3 grid gap-2">
                  <label>
                    <span className={labelClassName}>{t(locale, "admin.pots.size")}</span>
                    <select
                      className={inputClassName}
                      value={variantSize}
                      onChange={(e) => setVariantSize(e.target.value as PotSizeLabel)}
                    >
                      {POT_SIZE_LABELS.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className={labelClassName}>{t(locale, "admin.pots.color")}</span>
                    <input
                      className={inputClassName}
                      value={variantColor}
                      onChange={(e) => setVariantColor(e.target.value)}
                    />
                  </label>
                  <label>
                    <span className={labelClassName}>{t(locale, "admin.pots.colorHe")}</span>
                    <input
                      className={inputClassName}
                      value={variantColorHe}
                      onChange={(e) => setVariantColorHe(e.target.value)}
                    />
                  </label>
                  <label>
                    <span className={labelClassName}>{t(locale, "admin.pots.price")}</span>
                    <input
                      className={inputClassName}
                      type="number"
                      min={0}
                      step={0.01}
                      value={variantPrice}
                      onChange={(e) => setVariantPrice(e.target.value)}
                    />
                  </label>
                  {variantError ? <p className="text-sm text-red-700">{variantError}</p> : null}
                  <button
                    type="button"
                    disabled={isAddingVariant}
                    className="text-sm font-semibold text-emerald-800"
                    onClick={() => void handleAddVariant(pot.id)}
                  >
                    {t(locale, "admin.pots.save")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="mt-3 text-sm font-semibold text-emerald-800"
                  onClick={() => {
                    setVariantPotId(pot.id);
                    setVariantError(null);
                  }}
                >
                  {t(locale, "admin.pots.addVariant")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <AdminConfirmDialog
        open={deleteId != null}
        title={t(locale, "admin.pots.deleteTitle")}
        message={t(locale, "admin.pots.deleteMessage")}
        confirmLabel={t(locale, "admin.pots.deleteConfirm")}
        destructive
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (deleteBusy) return;
          setDeleteId(null);
          setDeleteError(null);
        }}
      />
    </section>
  );
}
