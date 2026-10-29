"use client";

import { useCallback, useEffect, useState } from "react";

import { AdminConfirmDialog } from "@/components/admin/shared/AdminConfirmDialog";
import { PlantImagePicker } from "@/components/admin/PlantImagePicker";
import { useLocale } from "@/components/locale/LocaleProvider";
import { displayApiError } from "@/lib/displayLabels";
import type { Locale } from "@/lib/locale";
import { t } from "@/lib/messages";
import { routes } from "@/lib/routes";

type PotRow = {
  id: string;
  name: string;
  nameHe?: string;
  image?: string;
  family?: string;
  diameterCm?: number;
  material?: string;
  color?: string;
  form?: "classic" | "tall" | "bowl";
  texture?: string;
  active?: boolean;
  supplierPrice?: number | null;
  quantity?: number;
};

type ApiResponse = {
  pots?: PotRow[];
  pot?: PotRow;
  error?: string;
};

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

function specLine(pot: PotRow): string {
  return [
    pot.diameterCm != null ? `${pot.diameterCm} cm` : null,
    pot.color,
    pot.form,
    pot.material,
    pot.texture,
  ]
    .filter((part): part is string => Boolean(part && String(part).trim()))
    .join(" · ");
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
  const [editSupplierCost, setEditSupplierCost] = useState("");
  const [editQuantity, setEditQuantity] = useState("0");
  const [editError, setEditError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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
    setEditSupplierCost(pot.supplierPrice == null ? "" : String(pot.supplierPrice));
    setEditQuantity(String(pot.quantity ?? 0));
    setEditError(null);
  }

  async function handleSave(potId: string) {
    setIsSaving(true);
    setEditError(null);
    const quantity = Number(editQuantity);
    if (!Number.isInteger(quantity) || quantity < 0) {
      setEditError(t(locale, "admin.pots.saveFailed"));
      setIsSaving(false);
      return;
    }
    const supplierPrice = editSupplierCost.trim() ? Number(editSupplierCost) : null;
    try {
      const res = await fetch(routes.api.pot(potId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          nameHe: editNameHe.trim() || null,
          image: editImage.trim() || null,
          supplierPrice,
          quantity,
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
          disabled={isCreating || !name.trim()}
          className="rounded-xl bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {isCreating ? t(locale, "admin.shared.saving") : t(locale, "admin.pots.create")}
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
            const details = specLine(pot);
            const quantity = pot.quantity ?? 0;
            return (
              <li
                key={pot.id}
                className="rounded-3xl bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.04)]"
              >
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
                      plantName={editName || pot.name}
                    />
                    <label className="block">
                      <span className={labelClassName}>{t(locale, "admin.pots.supplierCost")}</span>
                      <input
                        className={inputClassName}
                        inputMode="decimal"
                        value={editSupplierCost}
                        onChange={(e) => setEditSupplierCost(e.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className={labelClassName}>{t(locale, "admin.pots.quantity")}</span>
                      <input
                        className={inputClassName}
                        inputMode="numeric"
                        value={editQuantity}
                        onChange={(e) => setEditQuantity(e.target.value)}
                      />
                    </label>
                    {editError ? <p className="text-sm text-red-700">{editError}</p> : null}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleSave(pot.id)}
                        disabled={isSaving || !editName.trim()}
                        className="rounded-xl bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {isSaving ? t(locale, "admin.shared.saving") : t(locale, "admin.pots.save")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        disabled={isSaving}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800"
                      >
                        {t(locale, "admin.shared.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-3">
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
                      <div className="min-w-0">
                        <p className="font-semibold text-emerald-950">{pot.name}</p>
                        {pot.nameHe ? <p className="text-sm text-slate-600">{pot.nameHe}</p> : null}
                        {pot.family ? <p className="text-sm text-slate-600">{pot.family}</p> : null}
                        {details ? <p className="mt-1 text-sm text-slate-600">{details}</p> : null}
                        <p className="mt-2 text-sm font-medium text-slate-800">
                          {t(locale, "admin.pots.centralQty")}: {quantity}
                        </p>
                        <p className="text-sm text-slate-600">
                          {pot.supplierPrice == null
                            ? t(locale, "admin.pots.supplierCostEmpty")
                            : `${t(locale, "admin.pots.supplierCost")}: ${formatSupplierCost(pot.supplierPrice, locale)}`}
                        </p>
                        {pot.active === false ? (
                          <p className="mt-1 text-xs font-medium text-amber-800">
                            {t(locale, "admin.pots.inactive")}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(pot)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800"
                      >
                        {t(locale, "admin.pots.edit")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteId(pot.id);
                        }}
                        className="rounded-xl border border-red-100 bg-white px-3 py-1.5 text-sm font-semibold text-red-700"
                      >
                        {t(locale, "admin.pots.delete")}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
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
        onCancel={() => {
          if (!deleteBusy) setDeleteId(null);
        }}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
