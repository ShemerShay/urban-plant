"use client";

import { useMemo, useState } from "react";

import { AdminCheckboxList } from "@/components/admin/shared/AdminCheckboxList";
import { AdminConfirmDialog } from "@/components/admin/shared/AdminConfirmDialog";
import { AdminFormModal } from "@/components/admin/shared/AdminFormModal";
import { AdminMultiSelect } from "@/components/admin/shared/AdminMultiSelect";
import { AdminRadioGroup } from "@/components/admin/shared/AdminRadioGroup";
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

const SCOPE_OPTIONS = [
  { value: "pocket", label: "Pocket" },
  { value: "product", label: "Plant type" },
  { value: "selected", label: "Selected POS" },
  { value: "store", label: "Entire store" },
] as const;

function formatWateredLabel(lastWateredAt: string | undefined): string {
  if (!lastWateredAt) return "Not watered yet";
  if (isWateredRecently(lastWateredAt, 7)) return "Watered this week";
  const d = new Date(lastWateredAt);
  if (Number.isNaN(d.getTime())) return "Not watered yet";
  return `Last watered ${d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })}`;
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
      const name = offer?.productName ?? "Unknown plant";
      const prev = byProduct.get(pid);
      if (prev) prev.count += 1;
      else byProduct.set(pid, { productId: pid, productName: name, count: 1 });
    }
    return [...byProduct.values()]
      .sort((a, b) =>
        a.productName.localeCompare(b.productName, undefined, { sensitivity: "base" }),
      )
      .map((opt) => ({
        value: opt.productId,
        label: `${opt.productName} (${opt.count})`,
      }));
  }, [waterableSpots, offerById]);

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
        label: `Unassigned (${unassignedCount})`,
      });
    }
    return options;
  }, [pockets, waterableSpots]);

  const posSelectOptions = useMemo(
    () =>
      waterableSpots.map((spot) => {
        const offerName = offerById.get(spot.currentOfferId)?.productName ?? "—";
        return {
          value: spot.id,
          label: spot.spotName,
          description: `${offerName} · ${formatWateredLabel(spot.lastWateredAt)}`,
        };
      }),
    [waterableSpots, offerById],
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
        setError(data.error ?? "Could not mark plants as watered");
        return;
      }
      onWatered(data.posSpots ?? []);
      resetAndClose();
    } catch {
      setError("Could not mark plants as watered");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AdminFormModal
        open={open && !confirmOpen}
        title="Water plants"
        onCancel={resetAndClose}
        onSubmit={() => {
          setError(null);
          setConfirmOpen(true);
        }}
        busy={busy}
        error={error}
        canSubmit={canSubmit}
        submitLabel={
          targetCount > 0
            ? `Mark ${targetCount} plant${targetCount === 1 ? "" : "s"} as watered`
            : "Mark as watered"
        }
      >
        <p className="text-sm text-slate-600">
          Mark live plants at{" "}
          <span className="font-semibold text-emerald-950">{partnerName}</span> as watered.
          Only available and held-for-payment POS spots are updated.
        </p>

        <AdminRadioGroup
          name="water-scope"
          legend="Scope"
          value={scope}
          options={[...SCOPE_OPTIONS]}
          onChange={(next) => {
            setScope(next as WaterScope);
            setError(null);
          }}
        />

        {scope === "pocket" ? (
          <div className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Pockets</span>
            <AdminMultiSelect
              aria-label="Pockets"
              options={pocketSelectOptions}
              values={pocketKeys}
              onChange={setPocketKeys}
              emptyLabel="Select pockets…"
            />
          </div>
        ) : null}

        {scope === "product" ? (
          <div className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Plant types</span>
            <AdminMultiSelect
              aria-label="Plant types"
              options={plantTypeOptions}
              values={productIds}
              onChange={setProductIds}
              emptyLabel="Select plant types…"
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
                Select all live
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="text-xs font-medium text-slate-600 underline underline-offset-2"
              >
                Clear
              </button>
            </div>
            <AdminCheckboxList
              aria-label="POS spots"
              options={posSelectOptions}
              values={selectedIds}
              onChange={setSelectedIds}
              emptyMessage="No live plants at this store."
            />
          </div>
        ) : null}

        {scope === "store" ? (
          <p className="text-sm text-slate-600">
            {waterableSpots.length === 0
              ? "No live plants at this store."
              : `${waterableSpots.length} live plant${waterableSpots.length === 1 ? "" : "s"} will be marked.`}
          </p>
        ) : null}

        {targetCount > 0 && scope !== "store" ? (
          <p className="text-sm text-slate-600">
            {targetCount} plant{targetCount === 1 ? "" : "s"} selected.
          </p>
        ) : null}
      </AdminFormModal>

      <AdminConfirmDialog
        open={confirmOpen}
        title="Confirm watering"
        message={
          targetCount > 0
            ? `Mark ${targetCount} plant${targetCount === 1 ? "" : "s"} as watered now?\n\nThis updates last watered time for the selected live POS spots at ${partnerName}.`
            : ""
        }
        confirmLabel={`Mark ${targetCount} plant${targetCount === 1 ? "" : "s"} as watered`}
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

export function formatPosSpotWateredSummary(lastWateredAt: string | undefined): string {
  return formatWateredLabel(lastWateredAt);
}
