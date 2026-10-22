"use client";

import { useCallback, useEffect, useState } from "react";

import { AdminConfirmDialog } from "@/components/admin/shared/AdminConfirmDialog";
import { useLocale } from "@/components/locale/LocaleProvider";
import { displayApiError } from "@/lib/displayLabels";
import { formatPrice } from "@/lib/mockPlants";
import { t } from "@/lib/messages";
import { isPlantSizeLabel, type PlantSizeLabel } from "@/lib/plantSizes";
import { isPotSizeLabel, type PotSizeLabel } from "@/lib/potSizes";
import { routes } from "@/lib/routes";
import type { PlantProduct } from "@/lib/types";

type PlantSizeOption = {
  id: string;
  sizeLabel: PlantSizeLabel;
};

type PotSizeOption = {
  id: string;
  sizeLabel: PotSizeLabel;
};

type PotOption = {
  id: string;
  name: string;
  sizes: PotSizeOption[];
};

type SellableVariantRow = {
  sellableVariantId: string;
  plantSizeId: string;
  plantSizeLabel: PlantSizeLabel;
  potSizeId: string | null;
  potName: string | null;
  potSizeLabel: PotSizeLabel | null;
  supplierCost: number | null;
  missingPotSupplierCost: boolean;
};

const inputClassName =
  "mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900";
const labelClassName = "text-xs font-medium text-slate-500";

function variantTitle(row: SellableVariantRow, noPot: string): string {
  if (!row.potSizeId) return `${row.plantSizeLabel} · ${noPot}`;
  const pot = row.potName?.trim() || "";
  const size = row.potSizeLabel ?? "";
  return `${row.plantSizeLabel} · ${pot} ${size}`.trim();
}

export function AdminSellableVariantsSection({ plant }: { plant: PlantProduct }) {
  const locale = useLocale();
  const [rows, setRows] = useState<SellableVariantRow[]>([]);
  const [plantSizes, setPlantSizes] = useState<PlantSizeOption[]>([]);
  const [pots, setPots] = useState<PotOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [plantSizeId, setPlantSizeId] = useState("");
  const [potChoice, setPotChoice] = useState("");
  const [potSizeId, setPotSizeId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [variantRes, sizeRes, potRes] = await Promise.all([
        fetch(routes.api.sellableVariants(plant.id), { cache: "no-store" }),
        fetch(routes.api.plantVariants(plant.id), { cache: "no-store" }),
        fetch(routes.api.pots(), { cache: "no-store" }),
      ]);
      const variantData = (await variantRes.json().catch(() => ({}))) as {
        sellableVariants?: SellableVariantRow[];
        error?: string;
      };
      const sizeData = (await sizeRes.json().catch(() => ({}))) as {
        variants?: { id?: string; sizeLabel?: string }[];
        error?: string;
      };
      const potData = (await potRes.json().catch(() => ({}))) as {
        pots?: {
          id?: string;
          name?: string;
          sizes?: { id?: string; sizeLabel?: string }[];
        }[];
        error?: string;
      };
      if (!variantRes.ok) {
        setLoadError(displayApiError(locale, variantData.error, "admin.plants.sellableVariants.loadFailed"));
        setRows([]);
        return;
      }
      if (!sizeRes.ok || !potRes.ok) {
        setLoadError(t(locale, "admin.plants.sellableVariants.loadFailed"));
        return;
      }
      setRows(variantData.sellableVariants ?? []);
      setPlantSizes(
        (sizeData.variants ?? []).flatMap((row) => {
          const id = row.id?.trim() ?? "";
          const sizeLabel = row.sizeLabel?.trim();
          if (!id || !isPlantSizeLabel(sizeLabel)) return [];
          return [{ id, sizeLabel }];
        }),
      );
      setPots(
        (potData.pots ?? []).flatMap((pot) => {
          const id = pot.id?.trim() ?? "";
          const name = pot.name?.trim() ?? "";
          if (!id || !name) return [];
          const sizes = (pot.sizes ?? []).flatMap((size) => {
            const sizeId = size.id?.trim() ?? "";
            const sizeLabel = size.sizeLabel?.trim() ?? "";
            if (!sizeId || !isPotSizeLabel(sizeLabel)) return [];
            return [{ id: sizeId, sizeLabel }];
          });
          return [{ id, name, sizes }];
        }),
      );
    } catch {
      setLoadError(t(locale, "common.networkError"));
    } finally {
      setIsLoading(false);
    }
  }, [locale, plant.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedPot = pots.find((pot) => pot.id === potChoice);

  function resetForm() {
    setPlantSizeId("");
    setPotChoice("");
    setPotSizeId("");
    setCreateError(null);
  }

  async function handleCreate() {
    if (!plantSizeId || potChoice === "" || (potChoice !== "none" && !potSizeId)) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(routes.api.sellableVariants(plant.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plantSizeId,
          potSizeId: potChoice === "none" ? null : potSizeId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setCreateError(displayApiError(locale, data.error, "admin.plants.sellableVariants.createFailed"));
        return;
      }
      resetForm();
      setShowAdd(false);
      await load();
    } catch {
      setCreateError(t(locale, "common.networkError"));
    } finally {
      setIsCreating(false);
    }
  }

  async function confirmDelete() {
    if (!deleteId) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch(routes.api.sellableVariant(plant.id, deleteId), { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setDeleteError(displayApiError(locale, data.error, "admin.plants.sellableVariants.deleteFailed"));
        return;
      }
      setDeleteId(null);
      await load();
    } catch {
      setDeleteError(t(locale, "common.networkError"));
    } finally {
      setDeleteBusy(false);
    }
  }

  const canCreate =
    Boolean(plantSizeId) &&
    potChoice !== "" &&
    (potChoice === "none" || Boolean(potSizeId)) &&
    !isCreating;

  return (
    <section className="mt-5 border-t border-slate-100 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-emerald-950">
          {t(locale, "admin.plants.sellableVariants.title")}
        </h3>
        <button
          type="button"
          onClick={() => {
            setShowAdd((open) => !open);
            if (showAdd) resetForm();
          }}
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
        >
          {t(locale, "admin.plants.sellableVariants.add")}
        </button>
      </div>

      {isLoading ? (
        <p className="mt-3 text-sm text-slate-600">{t(locale, "admin.plants.sellableVariants.loading")}</p>
      ) : loadError ? (
        <p className="mt-3 text-sm text-red-700">{loadError}</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">{t(locale, "admin.plants.sellableVariants.empty")}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((row) => (
            <li
              key={row.sellableVariantId}
              className="flex items-start justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 p-3"
            >
              <div className="min-w-0 text-sm text-slate-800">
                <p className="font-medium text-emerald-950">
                  {variantTitle(row, t(locale, "admin.plants.sellableVariants.noPot"))}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {row.supplierCost == null
                    ? row.missingPotSupplierCost
                      ? `${t(locale, "admin.plants.sellableVariants.costUnavailable")}. ${t(locale, "admin.plants.sellableVariants.missingPotCost")}`
                      : t(locale, "admin.plants.sellableVariants.costUnavailable")
                    : `${t(locale, "admin.plants.sellableVariants.supplierCost")}: ${formatPrice(row.supplierCost, plant.currency, locale)}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteId(row.sellableVariantId);
                }}
                className="shrink-0 text-sm font-semibold text-red-700"
              >
                {t(locale, "admin.plants.sellableVariants.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {showAdd ? (
        <div className="mt-4 grid gap-3">
          <label>
            <span className={labelClassName}>{t(locale, "admin.plants.sellableVariants.plantSize")}</span>
            <select
              className={inputClassName}
              value={plantSizeId}
              onChange={(e) => setPlantSizeId(e.target.value)}
            >
              <option value="">—</option>
              {plantSizes.map((size) => (
                <option key={size.id} value={size.id}>
                  {size.sizeLabel}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelClassName}>{t(locale, "admin.plants.sellableVariants.pot")}</span>
            <select
              className={inputClassName}
              value={potChoice}
              onChange={(e) => {
                setPotChoice(e.target.value);
                setPotSizeId("");
              }}
            >
              <option value="">—</option>
              <option value="none">{t(locale, "admin.plants.sellableVariants.noPot")}</option>
              {pots.map((pot) => (
                <option key={pot.id} value={pot.id}>
                  {pot.name}
                </option>
              ))}
            </select>
          </label>
          {selectedPot ? (
            <label>
              <span className={labelClassName}>{t(locale, "admin.plants.sellableVariants.potSize")}</span>
              <select
                className={inputClassName}
                value={potSizeId}
                onChange={(e) => setPotSizeId(e.target.value)}
              >
                <option value="">—</option>
                {selectedPot.sizes.map((size) => (
                  <option key={size.id} value={size.id}>
                    {size.sizeLabel}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {createError ? <p className="text-sm text-red-700">{createError}</p> : null}
          <div>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!canCreate}
              className="rounded-xl bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {t(locale, "admin.plants.sellableVariants.create")}
            </button>
          </div>
        </div>
      ) : null}

      <AdminConfirmDialog
        open={deleteId != null}
        title={t(locale, "admin.plants.sellableVariants.deleteTitle")}
        message={t(locale, "admin.plants.sellableVariants.deleteMessage")}
        confirmLabel={t(locale, "admin.plants.sellableVariants.deleteConfirm")}
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
