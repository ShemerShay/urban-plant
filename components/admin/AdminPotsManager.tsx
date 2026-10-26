"use client";

import { useCallback, useEffect, useState } from "react";

import { AdminConfirmDialog } from "@/components/admin/shared/AdminConfirmDialog";
import { PlantImagePicker } from "@/components/admin/PlantImagePicker";
import { useLocale } from "@/components/locale/LocaleProvider";
import { displayApiError } from "@/lib/displayLabels";
import type { Locale } from "@/lib/locale";
import { t } from "@/lib/messages";
import { POT_SIZE_LABELS, type PotSizeLabel } from "@/lib/potSizes";
import { routes } from "@/lib/routes";

type PotColorRow = {
  id: string;
  potSizeId: string;
  color: string;
  colorHe?: string;
  quantity: number;
};

type PotSizeRow = {
  id: string;
  potId: string;
  sizeLabel: PotSizeLabel;
  supplierPrice: number | null;
  colors: PotColorRow[];
};

type PotRow = {
  id: string;
  name: string;
  nameHe?: string;
  image?: string;
  sizes: PotSizeRow[];
};

type ApiResponse = {
  pots?: PotRow[];
  error?: string;
};

type DeleteTarget =
  | { kind: "pot"; potId: string }
  | { kind: "size"; potId: string; sizeId: string }
  | { kind: "color"; potId: string; sizeId: string; colorId: string };

const inputClassName = "mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900";
const labelClassName = "text-xs font-medium text-slate-500";

function formatSupplierCost(price: number, locale: Locale): string {
  const hasFraction = Math.round(price * 100) % 100 !== 0;
  return new Intl.NumberFormat(locale === "he" ? "he-IL" : "en-US", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(price);
}

function openSizes(pot: PotRow, current?: PotSizeLabel): PotSizeLabel[] {
  const used = new Set(pot.sizes.map((size) => size.sizeLabel));
  return POT_SIZE_LABELS.filter((size) => size === current || !used.has(size));
}

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

  const [sizePotId, setSizePotId] = useState<string | null>(null);
  const [editingSizeId, setEditingSizeId] = useState<string | null>(null);
  const [sizeLabel, setSizeLabel] = useState<PotSizeLabel>("S");
  const [supplierCost, setSupplierCost] = useState("");
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [isSavingSize, setIsSavingSize] = useState(false);

  const [colorSizeId, setColorSizeId] = useState<string | null>(null);
  const [editingColorId, setEditingColorId] = useState<string | null>(null);
  const [color, setColor] = useState("");
  const [colorHe, setColorHe] = useState("");
  const [colorError, setColorError] = useState<string | null>(null);
  const [isSavingColor, setIsSavingColor] = useState(false);

  const [adjustColorId, setAdjustColorId] = useState<string | null>(null);
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [isAdjusting, setIsAdjusting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
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

  function startAddSize(pot: PotRow) {
    const available = openSizes(pot);
    const next = available[0];
    if (!next) return;
    setSizePotId(pot.id);
    setEditingSizeId(null);
    setSizeLabel(next);
    setSupplierCost("");
    setSizeError(null);
  }

  function startEditSize(size: PotSizeRow) {
    setSizePotId(size.potId);
    setEditingSizeId(size.id);
    setSizeLabel(size.sizeLabel);
    setSupplierCost(size.supplierPrice == null ? "" : String(size.supplierPrice));
    setSizeError(null);
  }

  async function handleSaveSize(potId: string) {
    setIsSavingSize(true);
    setSizeError(null);
    const supplierPrice = supplierCost.trim() ? Number(supplierCost) : null;
    try {
      const res = await fetch(
        editingSizeId ? routes.api.potSize(potId, editingSizeId) : routes.api.potSizes(potId),
        {
          method: editingSizeId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sizeLabel, supplierPrice }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok) {
        setSizeError(displayApiError(locale, data.error, "admin.pots.saveFailed"));
        return;
      }
      setSizePotId(null);
      setEditingSizeId(null);
      setSupplierCost("");
      await loadPots();
    } catch {
      setSizeError(t(locale, "common.networkError"));
    } finally {
      setIsSavingSize(false);
    }
  }

  function startAddColor(sizeId: string) {
    setColorSizeId(sizeId);
    setEditingColorId(null);
    setColor("");
    setColorHe("");
    setColorError(null);
  }

  function startEditColor(colorRow: PotColorRow) {
    setColorSizeId(colorRow.potSizeId);
    setEditingColorId(colorRow.id);
    setColor(colorRow.color);
    setColorHe(colorRow.colorHe ?? "");
    setColorError(null);
  }

  async function handleSaveColor(potId: string, sizeId: string) {
    setIsSavingColor(true);
    setColorError(null);
    try {
      const res = await fetch(
        editingColorId
          ? routes.api.potColor(potId, sizeId, editingColorId)
          : routes.api.potColors(potId, sizeId),
        {
          method: editingColorId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            color: color.trim(),
            colorHe: colorHe.trim() || null,
          }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok) {
        setColorError(displayApiError(locale, data.error, "admin.pots.saveFailed"));
        return;
      }
      setColorSizeId(null);
      setEditingColorId(null);
      setColor("");
      setColorHe("");
      await loadPots();
    } catch {
      setColorError(t(locale, "common.networkError"));
    } finally {
      setIsSavingColor(false);
    }
  }

  async function handleAdjust(potId: string, sizeId: string, colorId: string) {
    setIsAdjusting(true);
    setAdjustError(null);
    try {
      const res = await fetch(routes.api.potColorInventory(potId, sizeId, colorId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delta: Number(delta),
          note: note.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok) {
        setAdjustError(displayApiError(locale, data.error, "admin.pots.saveFailed"));
        return;
      }
      setAdjustColorId(null);
      setDelta("");
      setNote("");
      await loadPots();
    } catch {
      setAdjustError(t(locale, "common.networkError"));
    } finally {
      setIsAdjusting(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    const url =
      deleteTarget.kind === "pot"
        ? routes.api.pot(deleteTarget.potId)
        : deleteTarget.kind === "size"
          ? routes.api.potSize(deleteTarget.potId, deleteTarget.sizeId)
          : routes.api.potColor(deleteTarget.potId, deleteTarget.sizeId, deleteTarget.colorId);
    try {
      const res = await fetch(url, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok) {
        setDeleteError(displayApiError(locale, data.error, "admin.pots.deleteFailed"));
        return;
      }
      setDeleteTarget(null);
      await loadPots();
    } catch {
      setDeleteError(t(locale, "common.networkError"));
    } finally {
      setDeleteBusy(false);
    }
  }

  const deleteCopy =
    deleteTarget?.kind === "size"
      ? {
          title: t(locale, "admin.pots.deleteSizeTitle"),
          message: t(locale, "admin.pots.deleteSizeMessage"),
        }
      : deleteTarget?.kind === "color"
        ? {
            title: t(locale, "admin.pots.deleteColorTitle"),
            message: t(locale, "admin.pots.deleteColorMessage"),
          }
        : {
            title: t(locale, "admin.pots.deleteTitle"),
            message: t(locale, "admin.pots.deleteMessage"),
          };

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
        <p className={labelClassName}>{t(locale, "admin.pots.photo")}</p>
        <PlantImagePicker
          single
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
          {pots.map((pot) => {
            const sizeChoices = openSizes(
              pot,
              editingSizeId ? pot.sizes.find((size) => size.id === editingSizeId)?.sizeLabel : undefined,
            );
            const showSizeForm = sizePotId === pot.id;
            return (
              <li key={pot.id} className="rounded-3xl bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
                {editingId === pot.id ? (
                  <div className="space-y-3">
                    <label className="block">
                      <span className={labelClassName}>{t(locale, "admin.pots.name")}</span>
                      <input
                        className={inputClassName}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className={labelClassName}>{t(locale, "admin.pots.nameHe")}</span>
                      <input
                        className={inputClassName}
                        value={editNameHe}
                        onChange={(e) => setEditNameHe(e.target.value)}
                      />
                    </label>
                    <p className={labelClassName}>{t(locale, "admin.pots.photo")}</p>
                    <PlantImagePicker
                      single
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
                  <div className="flex gap-3">
                    {pot.image ? (
                      <img
                        src={pot.image}
                        alt=""
                        className="h-16 w-16 shrink-0 rounded-xl object-cover ring-1 ring-slate-200"
                      />
                    ) : (
                      <p className="max-w-40 text-sm text-amber-800">
                        {t(locale, "admin.pots.photoRequired")}
                      </p>
                    )}
                    <div>
                      <p className="font-medium text-emerald-950">{pot.name}</p>
                      {pot.nameHe ? <p className="text-sm text-slate-600">{pot.nameHe}</p> : null}
                      <div className="mt-2 flex gap-3">
                        <button type="button" className="text-sm text-emerald-800" onClick={() => startEdit(pot)}>
                          {t(locale, "admin.pots.edit")}
                        </button>
                        <button
                          type="button"
                          className="text-sm text-red-700"
                          onClick={() => setDeleteTarget({ kind: "pot", potId: pot.id })}
                        >
                          {t(locale, "admin.pots.delete")}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {pot.sizes.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-600">{t(locale, "admin.pots.noSizes")}</p>
                ) : (
                  <ul className="mt-4 space-y-3">
                    {pot.sizes.map((size) => {
                      const showColorForm = colorSizeId === size.id;
                      return (
                        <li key={size.id} className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="text-sm text-slate-800">
                              <p className="font-medium text-emerald-950">
                                {t(locale, "admin.pots.size")} {size.sizeLabel}
                              </p>
                              <p className="mt-1 text-xs text-slate-600">
                                {t(locale, "admin.pots.supplierCost")}:{" "}
                                {size.supplierPrice == null
                                  ? t(locale, "admin.pots.supplierCostEmpty")
                                  : formatSupplierCost(size.supplierPrice, locale)}
                              </p>
                            </div>
                            <div className="flex gap-3">
                              <button
                                type="button"
                                className="text-xs text-emerald-800"
                                onClick={() => startEditSize(size)}
                              >
                                {t(locale, "admin.pots.edit")}
                              </button>
                              <button
                                type="button"
                                className="text-xs text-red-700"
                                onClick={() =>
                                  setDeleteTarget({ kind: "size", potId: pot.id, sizeId: size.id })
                                }
                              >
                                {t(locale, "admin.pots.delete")}
                              </button>
                            </div>
                          </div>

                          <p className="mt-3 text-xs font-medium text-slate-500">
                            {t(locale, "admin.pots.colors")}
                          </p>
                          {size.colors.length === 0 ? (
                            <p className="mt-1 text-sm text-slate-600">{t(locale, "admin.pots.noColors")}</p>
                          ) : (
                            <ul className="mt-2 space-y-2">
                              {size.colors.map((colorRow) => (
                                <li key={colorRow.id} className="rounded-xl bg-white px-3 py-2 text-sm">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-slate-800">
                                      {colorRow.color}
                                      {colorRow.colorHe ? ` · ${colorRow.colorHe}` : ""} ·{" "}
                                      {t(locale, "admin.pots.quantity")}: {colorRow.quantity}
                                    </span>
                                    <span className="flex gap-3">
                                      <button
                                        type="button"
                                        className="text-xs text-emerald-800"
                                        onClick={() => startEditColor(colorRow)}
                                      >
                                        {t(locale, "admin.pots.edit")}
                                      </button>
                                      <button
                                        type="button"
                                        className="text-xs text-emerald-800"
                                        onClick={() => {
                                          setAdjustColorId(colorRow.id);
                                          setDelta("");
                                          setNote("");
                                          setAdjustError(null);
                                        }}
                                      >
                                        {t(locale, "admin.pots.adjust")}
                                      </button>
                                      <button
                                        type="button"
                                        className="text-xs text-red-700"
                                        onClick={() =>
                                          setDeleteTarget({
                                            kind: "color",
                                            potId: pot.id,
                                            sizeId: size.id,
                                            colorId: colorRow.id,
                                          })
                                        }
                                      >
                                        {t(locale, "admin.pots.delete")}
                                      </button>
                                    </span>
                                  </div>
                                  {adjustColorId === colorRow.id ? (
                                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                      <label>
                                        <span className={labelClassName}>{t(locale, "admin.pots.delta")}</span>
                                        <input
                                          className={inputClassName}
                                          type="number"
                                          step={1}
                                          value={delta}
                                          onChange={(e) => setDelta(e.target.value)}
                                        />
                                      </label>
                                      <label>
                                        <span className={labelClassName}>{t(locale, "admin.pots.note")}</span>
                                        <input
                                          className={inputClassName}
                                          value={note}
                                          onChange={(e) => setNote(e.target.value)}
                                        />
                                      </label>
                                      {adjustError ? (
                                        <p className="text-sm text-red-700 sm:col-span-2">{adjustError}</p>
                                      ) : null}
                                      <button
                                        type="button"
                                        disabled={isAdjusting || !delta.trim() || !note.trim()}
                                        className="text-sm font-semibold text-emerald-800 disabled:opacity-50"
                                        onClick={() => void handleAdjust(pot.id, size.id, colorRow.id)}
                                      >
                                        {t(locale, "admin.pots.applyAdjust")}
                                      </button>
                                    </div>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          )}

                          {showColorForm ? (
                            <div className="mt-3 grid gap-2">
                              <label>
                                <span className={labelClassName}>{t(locale, "admin.pots.color")}</span>
                                <input
                                  className={inputClassName}
                                  value={color}
                                  onChange={(e) => setColor(e.target.value)}
                                />
                              </label>
                              <label>
                                <span className={labelClassName}>{t(locale, "admin.pots.colorHe")}</span>
                                <input
                                  className={inputClassName}
                                  value={colorHe}
                                  onChange={(e) => setColorHe(e.target.value)}
                                />
                              </label>
                              {colorError ? <p className="text-sm text-red-700">{colorError}</p> : null}
                              <button
                                type="button"
                                disabled={isSavingColor || !color.trim()}
                                className="text-sm font-semibold text-emerald-800 disabled:opacity-50"
                                onClick={() => void handleSaveColor(pot.id, size.id)}
                              >
                                {t(locale, "admin.pots.save")}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="mt-3 text-sm font-semibold text-emerald-800"
                              onClick={() => startAddColor(size.id)}
                            >
                              {t(locale, "admin.pots.addColor")}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {showSizeForm ? (
                  <div className="mt-3 grid gap-2">
                    <label>
                      <span className={labelClassName}>{t(locale, "admin.pots.size")}</span>
                      <select
                        className={inputClassName}
                        value={sizeLabel}
                        onChange={(e) => setSizeLabel(e.target.value as PotSizeLabel)}
                      >
                        {sizeChoices.map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className={labelClassName}>{t(locale, "admin.pots.supplierCost")}</span>
                      <input
                        className={inputClassName}
                        type="number"
                        min={0}
                        step={0.01}
                        value={supplierCost}
                        onChange={(e) => setSupplierCost(e.target.value)}
                      />
                    </label>
                    {sizeError ? <p className="text-sm text-red-700">{sizeError}</p> : null}
                    <button
                      type="button"
                      disabled={isSavingSize || sizeChoices.length === 0}
                      className="text-sm font-semibold text-emerald-800 disabled:opacity-50"
                      onClick={() => void handleSaveSize(pot.id)}
                    >
                      {t(locale, "admin.pots.save")}
                    </button>
                  </div>
                ) : openSizes(pot).length > 0 ? (
                  <button
                    type="button"
                    className="mt-3 text-sm font-semibold text-emerald-800"
                    onClick={() => startAddSize(pot)}
                  >
                    {t(locale, "admin.pots.addSize")}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <AdminConfirmDialog
        open={deleteTarget != null}
        title={deleteCopy.title}
        message={deleteCopy.message}
        confirmLabel={
          deleteTarget?.kind === "pot"
            ? t(locale, "admin.pots.deleteConfirm")
            : t(locale, "admin.pots.delete")
        }
        destructive
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (deleteBusy) return;
          setDeleteTarget(null);
          setDeleteError(null);
        }}
      />
    </section>
  );
}
