"use client";

import { useMemo, useState } from "react";

import { useLocale } from "@/components/locale/LocaleProvider";
import { AdminCheckboxList } from "@/components/admin/shared/AdminCheckboxList";
import { AdminConfirmDialog } from "@/components/admin/shared/AdminConfirmDialog";
import { AdminFormModal } from "@/components/admin/shared/AdminFormModal";
import { AdminMultiSelect } from "@/components/admin/shared/AdminMultiSelect";
import { AdminRadioGroup } from "@/components/admin/shared/AdminRadioGroup";
import { displayApiError } from "@/lib/displayLabels";
import type { Locale } from "@/lib/locale";
import { t } from "@/lib/messages";
import type { Pocket } from "@/lib/pocketTypes";
import type { PosSpot } from "@/lib/posSpotTypes";
import { isPosSpotWaterable, isWateredRecently } from "@/lib/posSpotWatering";
import { routes } from "@/lib/routes";

type OfferOption = {
  id: string;
  productId: string;
  productName: string;
};

export type WaterScope = "pocket" | "product" | "selected" | "store";

type AdminWaterPlantsPanelProps = {
  open: boolean;
  partnerId: string;
  partnerName: string;
  pockets: Pocket[];
  posSpots: PosSpot[];
  offers: OfferOption[];
  onClose: () => void;
  onWatered: (updated: PosSpot[]) => void;
};

const UNASSIGNED_POCKET_KEY = "__unassigned__";

function intlLocale(locale: Locale): string {
  return locale === "he" ? "he-IL" : "en-US";
}

function scopeOptions(locale: Locale) {
  return [
    { value: "pocket", label: t(locale, "admin.water.scopePocket") },
    { value: "product", label: t(locale, "admin.water.scopeProduct") },
    { value: "selected", label: t(locale, "admin.water.scopeSelected") },
    { value: "store", label: t(locale, "admin.water.scopeStore") },
  ] as const;
}

function formatWateredLabel(locale: Locale, lastWateredAt: string | undefined): string {
  if (!lastWateredAt) return t(locale, "admin.water.notWateredYet");
  if (isWateredRecently(lastWateredAt, 7)) return t(locale, "admin.water.wateredThisWeek");
  const d = new Date(lastWateredAt);
  if (Number.isNaN(d.getTime())) return t(locale, "admin.water.notWateredYet");
  return t(locale, "admin.water.lastWatered", {
    date: d.toLocaleDateString(intlLocale(locale), {
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
  });
}

export function AdminWaterPlantsPanel({
  open,
  partnerId,
  partnerName,
  pockets,
  posSpots,
  offers,
  onClose,
  onWatered,
}: AdminWaterPlantsPanelProps) {
  const locale = useLocale();
  const [scope, setScope] = useState<WaterScope>("pocket");
  const [pocketKeys, setPocketKeys] = useState<string[]>([]);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offerById = useMemo(() => {
    const map = new Map<string, OfferOption>();
    for (const offer of offers) map.set(offer.id, offer);
    return map;
  }, [offers]);

  const waterableSpots = useMemo(
    () => posSpots.filter((spot) => isPosSpotWaterable(spot)),
    [posSpots],
  );

  const plantTypeOptions = useMemo(() => {
    const byProduct = new Map<string, { productId: string; productName: string; count: number }>();
    for (const spot of waterableSpots) {
      const offer = offerById.get(spot.currentOfferId);
      const pid = offer?.productId ?? spot.currentOfferId;
      const name = offer?.productName ?? t(locale, "admin.water.unknownPlant");
      const prev = byProduct.get(pid);
      if (prev) prev.count += 1;
      else byProduct.set(pid, { productId: pid, productName: name, count: 1 });
    }
    return [...byProduct.values()]
      .sort((a, b) =>
        a.productName.localeCompare(b.productName, intlLocale(locale), { sensitivity: "base" }),
      )
      .map((opt) => ({
        value: opt.productId,
        label: `${opt.productName} (${opt.count})`,
      }));
  }, [waterableSpots, offerById, locale]);

  const pocketSelectOptions = useMemo(() => {
    const options = pockets.map((pocket) => {
      const count = waterableSpots.filter((s) => s.pocketId === pocket.id).length;
      return {
        value: pocket.id,
        label: `${pocket.name} (${count})`,
      };
    });
    const unassignedCount = waterableSpots.filter((s) => !s.pocketId).length;
    if (unassignedCount > 0) {
      options.push({
        value: UNASSIGNED_POCKET_KEY,
        label: t(locale, "admin.water.unassigned", { count: unassignedCount }),
      });
    }
    return options;
  }, [pockets, waterableSpots, locale]);

  const posSelectOptions = useMemo(
    () =>
      waterableSpots.map((spot) => {
        const offerName = offerById.get(spot.currentOfferId)?.productName ?? "—";
        return {
          value: spot.id,
          label: spot.spotName,
          description: `${offerName} · ${formatWateredLabel(locale, spot.lastWateredAt)}`,
        };
      }),
    [waterableSpots, offerById, locale],
  );

  const pocketKeySet = useMemo(() => new Set(pocketKeys), [pocketKeys]);
  const productIdSet = useMemo(() => new Set(productIds), [productIds]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const targetSpots = useMemo(() => {
    if (scope === "store") return waterableSpots;
    if (scope === "pocket") {
      if (pocketKeySet.size === 0) return [];
      return waterableSpots.filter((s) => {
        if (!s.pocketId) return pocketKeySet.has(UNASSIGNED_POCKET_KEY);
        return pocketKeySet.has(s.pocketId);
      });
    }
    if (scope === "product") {
      if (productIdSet.size === 0) return [];
      return waterableSpots.filter((s) => {
        const offer = offerById.get(s.currentOfferId);
        return productIdSet.has(offer?.productId ?? s.currentOfferId);
      });
    }
    return waterableSpots.filter((s) => selectedIdSet.has(s.id));
  }, [
    scope,
    waterableSpots,
    pocketKeySet,
    productIdSet,
    selectedIdSet,
    offerById,
  ]);

  const targetCount = targetSpots.length;
  const canSubmit =
    targetCount > 0 &&
    (scope === "store" ||
      (scope === "pocket" && pocketKeys.length > 0) ||
      (scope === "product" && productIds.length > 0) ||
      (scope === "selected" && selectedIds.length > 0));

  function resetAndClose() {
    setConfirmOpen(false);
    setError(null);
    setBusy(false);
    onClose();
  }

  async function confirmWater() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(routes.api.posSpotsWater(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerLocationId: partnerId,
          posSpotIds: targetSpots.map((s) => s.id),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        posSpots?: PosSpot[];
        updatedCount?: number;
      };
      if (!res.ok) {
        setError(displayApiError(locale, data.error, "admin.water.failed"));
        return;
      }
      onWatered(data.posSpots ?? []);
      resetAndClose();
    } catch {
      setError(t(locale, "admin.water.failed"));
    } finally {
      setBusy(false);
    }
  }

  const submitLabel =
    targetCount > 0
      ? targetCount === 1
        ? t(locale, "admin.water.markSubmitOne")
        : t(locale, "admin.water.markSubmitMany", { count: targetCount })
      : t(locale, "admin.water.markSubmit");

  const confirmLabel =
    targetCount === 1
      ? t(locale, "admin.water.confirmLabelOne")
      : t(locale, "admin.water.confirmLabelMany", { count: targetCount });

  const confirmMessage =
    targetCount > 0
      ? targetCount === 1
        ? t(locale, "admin.water.confirmMessageOne", { name: partnerName })
        : t(locale, "admin.water.confirmMessageMany", { count: targetCount, name: partnerName })
      : "";

  return (
    <>
      <AdminFormModal
        open={open && !confirmOpen}
        title={t(locale, "admin.water.title")}
        onCancel={resetAndClose}
        onSubmit={() => {
          setError(null);
          setConfirmOpen(true);
        }}
        busy={busy}
        error={error}
        canSubmit={canSubmit}
        submitLabel={submitLabel}
      >
        <p className="text-sm text-slate-600">
          {t(locale, "admin.water.intro", { name: partnerName })}
        </p>

        <AdminRadioGroup
          name="water-scope"
          legend={t(locale, "admin.water.scope")}
          value={scope}
          options={[...scopeOptions(locale)]}
          onChange={(next) => {
            setScope(next as WaterScope);
            setError(null);
          }}
        />

        {scope === "pocket" ? (
          <div className="space-y-1">
            <span className="text-sm font-medium text-slate-700">
              {t(locale, "admin.water.pockets")}
            </span>
            <AdminMultiSelect
              aria-label={t(locale, "admin.water.pocketsAria")}
              options={pocketSelectOptions}
              values={pocketKeys}
              onChange={setPocketKeys}
              emptyLabel={t(locale, "admin.water.selectPockets")}
            />
          </div>
        ) : null}

        {scope === "product" ? (
          <div className="space-y-1">
            <span className="text-sm font-medium text-slate-700">
              {t(locale, "admin.water.plantTypes")}
            </span>
            <AdminMultiSelect
              aria-label={t(locale, "admin.water.plantTypesAria")}
              options={plantTypeOptions}
              values={productIds}
              onChange={setProductIds}
              emptyLabel={t(locale, "admin.water.selectPlantTypes")}
            />
          </div>
        ) : null}

        {scope === "selected" ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setSelectedIds(waterableSpots.map((s) => s.id))}
                className="text-xs font-medium text-emerald-700 underline underline-offset-2"
              >
                {t(locale, "admin.water.selectAllLive")}
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="text-xs font-medium text-slate-600 underline underline-offset-2"
              >
                {t(locale, "admin.water.clear")}
              </button>
            </div>
            <AdminCheckboxList
              aria-label={t(locale, "admin.water.posSpotsAria")}
              options={posSelectOptions}
              values={selectedIds}
              onChange={setSelectedIds}
              emptyMessage={t(locale, "admin.water.noLivePlants")}
            />
          </div>
        ) : null}

        {scope === "store" ? (
          <p className="text-sm text-slate-600">
            {waterableSpots.length === 0
              ? t(locale, "admin.water.noLivePlants")
              : waterableSpots.length === 1
                ? t(locale, "admin.water.willMarkOne")
                : t(locale, "admin.water.willMarkMany", { count: waterableSpots.length })}
          </p>
        ) : null}

        {targetCount > 0 && scope !== "store" ? (
          <p className="text-sm text-slate-600">
            {targetCount === 1
              ? t(locale, "admin.water.selectedOne")
              : t(locale, "admin.water.selectedMany", { count: targetCount })}
          </p>
        ) : null}
      </AdminFormModal>

      <AdminConfirmDialog
        open={confirmOpen}
        title={t(locale, "admin.water.confirmTitle")}
        message={confirmMessage}
        confirmLabel={confirmLabel}
        busy={busy}
        error={error}
        onCancel={() => {
          if (!busy) {
            setConfirmOpen(false);
            setError(null);
          }
        }}
        onConfirm={() => void confirmWater()}
      />
    </>
  );
}

export function formatPosSpotWateredSummary(
  lastWateredAt: string | undefined,
  locale: Locale,
): string {
  return formatWateredLabel(locale, lastWateredAt);
}
