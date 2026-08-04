"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import QRCode from "react-qr-code";

import { AdminConfirmDialog } from "@/components/admin/shared/AdminConfirmDialog";
import { AdminEmptyState } from "@/components/admin/shared/AdminEmptyState";
import { AdminEntityList } from "@/components/admin/shared/AdminEntityList";
import { AdminFormModal } from "@/components/admin/shared/AdminFormModal";
import { AdminManagementSection } from "@/components/admin/shared/AdminManagementSection";
import type { PartnerLocation } from "@/lib/partnerLocationStorage";
import type { Pocket } from "@/lib/pocketTypes";
import { resolvePosSpotPocketLabel } from "@/lib/posSpotPocket";
import type { PosSpot, PosSpotStatus } from "@/lib/posSpotTypes";
import { POS_HELD_FOR_PAYMENT_ADMIN_LABEL } from "@/lib/status";
import {
  buildPosSpotNameAndSlug,
  formatPosSpotDisplayName,
  suggestNextPosNumber,
} from "@/lib/posSpotSlugUtils";
import { absoluteAppUrl, getClientOrigin, posSpotPath, routes } from "@/lib/routes";

type OfferOption = {
  id: string;
  productId: string;
  productName: string;
  consumerPrice: number;
  currency: "ILS" | "USD" | "EUR";
  status: "active" | "inactive";
};

type AdminPartnerDetailProps = {
  partnerId: string;
};

function subscribeToNothing(): () => void {
  return () => {};
}

function useClientOrigin(): string {
  return useSyncExternalStore(subscribeToNothing, getClientOrigin, () => "");
}

function posSpotStatusLabel(status: PosSpotStatus): string {
  if (status === "available") return "Available";
  if (status === "sold") return "Unavailable";
  if (status === "held_for_payment") return POS_HELD_FOR_PAYMENT_ADMIN_LABEL;
  return "Inactive";
}

function posSpotStatusClassName(status: PosSpotStatus): string {
  if (status === "available") return "bg-emerald-100 text-emerald-800";
  if (status === "sold") return "bg-slate-100 text-slate-700";
  if (status === "held_for_payment") return "bg-amber-100 text-amber-900";
  return "bg-amber-100 text-amber-800";
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

function PocketSpotRow({
  spot,
  onEdit,
  onArchive,
}: {
  spot: PosSpot;
  onEdit: () => void;
  onArchive: () => void;
}) {
  return (
    <li className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-emerald-950">{spot.spotName}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${posSpotStatusClassName(spot.status)}`}
            >
              {posSpotStatusLabel(spot.status)}
            </span>
          </div>
          <dl className="mt-2 grid gap-1">
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-slate-500">Display</dt>
              <dd className="text-slate-900">{spot.posName}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-slate-500">Slug</dt>
              <dd className="font-mono text-xs text-slate-900">{spot.spotSlug}</dd>
            </div>
          </dl>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href={posSpotPath(spot.spotSlug)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-emerald-700 underline underline-offset-2"
          >
            Open
          </Link>
          <button
            type="button"
            onClick={onEdit}
            className="text-xs font-medium text-emerald-700 underline underline-offset-2"
          >
            Edit
          </button>
          {spot.status !== "inactive" ? (
            <button
              type="button"
              onClick={onArchive}
              className="text-xs font-medium text-red-700 underline underline-offset-2"
            >
              Delete
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function ExpandablePocketCard({
  title,
  subtitle,
  spots,
  actions,
  onEditSpot,
  onArchiveSpot,
}: {
  title: string;
  subtitle: string;
  spots: PosSpot[];
  actions?: ReactNode;
  onEditSpot: (spot: PosSpot) => void;
  onArchiveSpot: (spot: PosSpot) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/40">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left transition hover:bg-slate-50/80"
          aria-expanded={isOpen}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-emerald-950">{title}</span>
            <span className="mt-0.5 block truncate text-xs text-slate-500">{subtitle}</span>
          </span>
          <IconChevron className="h-5 w-5 shrink-0 text-slate-500" open={isOpen} />
        </button>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2 px-3">{actions}</div>
        ) : null}
      </div>

      {isOpen ? (
        <div className="border-t border-slate-100 px-3 pb-3 pt-3">
          {spots.length === 0 ? (
            <p className="text-sm text-slate-500">No POS spots in this pocket.</p>
          ) : (
            <ul className="space-y-2">
              {spots.map((spot) => (
                <PocketSpotRow
                  key={spot.id}
                  spot={spot}
                  onEdit={() => onEditSpot(spot)}
                  onArchive={() => onArchiveSpot(spot)}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </article>
  );
}

export function AdminPartnerDetail({ partnerId }: AdminPartnerDetailProps) {
  const origin = useClientOrigin();
  const qrHostRef = useRef<HTMLDivElement>(null);

  const [partner, setPartner] = useState<PartnerLocation | null>(null);
  const [pockets, setPockets] = useState<Pocket[]>([]);
  const [posSpots, setPosSpots] = useState<PosSpot[]>([]);
  const [offers, setOffers] = useState<OfferOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [pocketModal, setPocketModal] = useState<"create" | "edit" | null>(null);
  const [editingPocket, setEditingPocket] = useState<Pocket | null>(null);
  const [pocketNameDraft, setPocketNameDraft] = useState("");
  const [pocketBusy, setPocketBusy] = useState(false);
  const [pocketError, setPocketError] = useState<string | null>(null);
  const [deletePocketTarget, setDeletePocketTarget] = useState<Pocket | null>(null);
  const [deletePocketBusy, setDeletePocketBusy] = useState(false);
  const [deletePocketError, setDeletePocketError] = useState<string | null>(null);

  const [createSpotOpen, setCreateSpotOpen] = useState(false);
  const [editSpot, setEditSpot] = useState<PosSpot | null>(null);
  const [spotBusy, setSpotBusy] = useState(false);
  const [spotError, setSpotError] = useState<string | null>(null);
  const [posNumber, setPosNumber] = useState("");
  const [pocketId, setPocketId] = useState("");
  const [currentOfferId, setCurrentOfferId] = useState("");
  const [spotDescription, setSpotDescription] = useState("");
  const [placementNotes, setPlacementNotes] = useState("");
  const [spotStatus, setSpotStatus] = useState<PosSpotStatus>("available");
  const [archiveTarget, setArchiveTarget] = useState<PosSpot | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);

  const pocketNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const pocket of pockets) map.set(pocket.id, pocket.name);
    return map;
  }, [pockets]);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const [partnersRes, pocketsRes, spotsRes] = await Promise.all([
        fetch(routes.api.partners(), { cache: "no-store" }),
        fetch(routes.api.partnerPockets(partnerId), { cache: "no-store" }),
        fetch(`${routes.api.posSpots()}?partnerId=${encodeURIComponent(partnerId)}`, {
          cache: "no-store",
        }),
      ]);

      if (!partnersRes.ok) throw new Error("Could not load partners");
      if (!pocketsRes.ok) throw new Error("Could not load pockets");
      if (!spotsRes.ok) throw new Error("Could not load POS spots");

      const partnersData = (await partnersRes.json()) as {
        partners?: PartnerLocation[];
      };
      const pocketsData = (await pocketsRes.json()) as { pockets?: Pocket[] };
      const spotsData = (await spotsRes.json()) as {
        posSpots?: PosSpot[];
        offers?: OfferOption[];
      };

      const found = (partnersData.partners ?? []).find((p) => p.id === partnerId) ?? null;
      if (!found) {
        setPartner(null);
        setLoadError("Partner not found");
        return;
      }

      setPartner(found);
      setPockets(pocketsData.pockets ?? []);
      setPosSpots(spotsData.posSpots ?? []);
      setOffers((spotsData.offers ?? []).filter((o) => o.status === "active"));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load partner");
    } finally {
      setLoading(false);
    }
  }, [partnerId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const assignedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const spot of posSpots) {
      if (!spot.pocketId) continue;
      counts.set(spot.pocketId, (counts.get(spot.pocketId) ?? 0) + 1);
    }
    return counts;
  }, [posSpots]);

  const spotsByPocketId = useMemo(() => {
    const map = new Map<string, PosSpot[]>();
    for (const spot of posSpots) {
      if (!spot.pocketId) continue;
      const list = map.get(spot.pocketId) ?? [];
      list.push(spot);
      map.set(spot.pocketId, list);
    }
    return map;
  }, [posSpots]);

  const unassignedSpots = useMemo(
    () => posSpots.filter((spot) => !spot.pocketId),
    [posSpots],
  );

  function openCreatePocket() {
    setEditingPocket(null);
    setPocketNameDraft("");
    setPocketError(null);
    setPocketModal("create");
  }

  function openEditPocket(pocket: Pocket) {
    setEditingPocket(pocket);
    setPocketNameDraft(pocket.name);
    setPocketError(null);
    setPocketModal("edit");
  }

  async function savePocket() {
    const name = pocketNameDraft.trim();
    if (!name) {
      setPocketError("Name is required");
      return;
    }
    setPocketBusy(true);
    setPocketError(null);
    try {
      const url =
        pocketModal === "edit" && editingPocket
          ? routes.api.partnerPocket(partnerId, editingPocket.id)
          : routes.api.partnerPockets(partnerId);
      const method = pocketModal === "edit" ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setPocketError(data.error ?? "Could not save pocket");
        return;
      }
      setPocketModal(null);
      await loadAll();
    } catch {
      setPocketError("Could not save pocket");
    } finally {
      setPocketBusy(false);
    }
  }

  async function confirmDeletePocket() {
    if (!deletePocketTarget) return;
    setDeletePocketBusy(true);
    setDeletePocketError(null);
    try {
      const res = await fetch(routes.api.partnerPocket(partnerId, deletePocketTarget.id), {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setDeletePocketError(data.error ?? "Could not delete pocket");
        return;
      }
      setDeletePocketTarget(null);
      await loadAll();
    } catch {
      setDeletePocketError("Could not delete pocket");
    } finally {
      setDeletePocketBusy(false);
    }
  }

  function openCreateSpot() {
    setEditSpot(null);
    setPosNumber(suggestNextPosNumber(posSpots.map((s) => s.posNumber)));
    setPocketId("");
    setCurrentOfferId(offers[0]?.id ?? "");
    setSpotDescription("");
    setPlacementNotes("");
    setSpotStatus("available");
    setSpotError(null);
    setCreateSpotOpen(true);
  }

  function openEditSpot(spot: PosSpot) {
    setEditSpot(spot);
    setPosNumber(spot.posNumber ?? "");
    setPocketId(spot.pocketId ?? "");
    setCurrentOfferId(spot.currentOfferId);
    setSpotDescription(spot.spotDescription ?? "");
    setPlacementNotes(spot.placementNotes ?? "");
    setSpotStatus(
      spot.status === "inactive"
        ? "inactive"
        : spot.status === "sold"
          ? "sold"
          : spot.status === "held_for_payment"
            ? "held_for_payment"
            : "available",
    );
    setSpotError(null);
    setCreateSpotOpen(true);
  }

  const selectedPocketName = pocketId ? pocketNameById.get(pocketId) : undefined;
  const previewIdentity = useMemo(() => {
    if (!partner?.name || !posNumber.trim()) {
      return { spotName: "", spotSlug: "", posName: "" };
    }
    if (editSpot) {
      return {
        spotName: editSpot.spotName,
        spotSlug: editSpot.spotSlug,
        posName: formatPosSpotDisplayName(partner.name, posNumber, selectedPocketName),
      };
    }
    const generated = buildPosSpotNameAndSlug(partner.name, posNumber);
    return {
      ...generated,
      posName: formatPosSpotDisplayName(partner.name, posNumber, selectedPocketName),
    };
  }, [partner?.name, posNumber, selectedPocketName, editSpot]);

  const relativePath = previewIdentity.spotSlug ? posSpotPath(previewIdentity.spotSlug) : "";
  const fullUrl = origin && relativePath ? absoluteAppUrl(origin, relativePath) : "";

  async function saveSpot() {
    if (!partner) return;
    if (!posNumber.trim()) {
      setSpotError("POS number is required");
      return;
    }
    if (!currentOfferId.trim()) {
      setSpotError("Offer is required");
      return;
    }
    setSpotBusy(true);
    setSpotError(null);
    try {
      if (editSpot) {
        const res = await fetch(routes.api.posSpot(editSpot.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            partnerLocationId: partner.id,
            partnerLocationAddress: partner.address,
            posNumber: posNumber.trim(),
            pocketId: pocketId || null,
            currentOfferId,
            status: spotStatus,
            ...(spotDescription.trim() ? { spotDescription: spotDescription.trim() } : {}),
            ...(placementNotes.trim() ? { placementNotes: placementNotes.trim() } : {}),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setSpotError(data.error ?? "Could not update POS Spot");
          return;
        }
      } else {
        const res = await fetch(routes.api.posSpots(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            partnerLocationId: partner.id,
            posNumber: posNumber.trim(),
            ...(pocketId ? { pocketId } : {}),
            currentOfferId,
            status: spotStatus,
            ...(spotDescription.trim() ? { spotDescription: spotDescription.trim() } : {}),
            ...(placementNotes.trim() ? { placementNotes: placementNotes.trim() } : {}),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setSpotError(data.error ?? "Could not create POS Spot");
          return;
        }
      }
      setCreateSpotOpen(false);
      setEditSpot(null);
      await loadAll();
    } catch {
      setSpotError("Could not save POS Spot");
    } finally {
      setSpotBusy(false);
    }
  }

  async function confirmArchiveSpot() {
    if (!archiveTarget || !partner) return;
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      const res = await fetch(routes.api.posSpot(archiveTarget.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerLocationId: partner.id,
          partnerLocationAddress: partner.address,
          posNumber: archiveTarget.posNumber ?? "",
          currentOfferId: archiveTarget.currentOfferId,
          pocketId: archiveTarget.pocketId ?? null,
          status: "inactive",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setArchiveError(data.error ?? "Could not deactivate POS Spot");
        return;
      }
      setArchiveTarget(null);
      await loadAll();
    } catch {
      setArchiveError("Could not deactivate POS Spot");
    } finally {
      setArchiveBusy(false);
    }
  }

  async function handleCopyUrl() {
    if (!fullUrl) return;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopyHint("Copied");
      window.setTimeout(() => setCopyHint(null), 2000);
    } catch {
      setCopyHint("Could not copy");
      window.setTimeout(() => setCopyHint(null), 2000);
    }
  }

  function handleDownloadQr() {
    const svg = qrHostRef.current?.querySelector("svg");
    if (!svg || !previewIdentity.spotSlug) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    if (!clone.getAttribute("xmlns")) {
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }
    const serializer = new XMLSerializer();
    const source = `<?xml version="1.0" encoding="UTF-8"?>\n${serializer.serializeToString(clone)}`;
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const safeSlug = previewIdentity.spotSlug.replace(/[^a-zA-Z0-9_-]/g, "");
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = `urban-plant-qr-${safeSlug}.svg`;
    anchor.click();
    URL.revokeObjectURL(blobUrl);
  }

  if (loading) {
    return <p className="text-sm text-slate-600">Loading partner…</p>;
  }

  if (!partner) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-700">{loadError ?? "Partner not found"}</p>
        <Link
          href={routes.admin.partners()}
          className="text-sm font-medium text-emerald-700 underline underline-offset-2"
        >
          Back to partners
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
            Partner
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-emerald-950">{partner.name}</h1>
          <p className="mt-1 text-sm text-slate-600">{partner.address}</p>
          <p className="mt-0.5 text-sm text-slate-500">{partner.type}</p>
        </div>
        <Link
          href={routes.admin.partners()}
          className="text-sm font-medium text-emerald-700 underline underline-offset-2"
        >
          All partners
        </Link>
      </div>

      {loadError ? <p className="text-sm text-red-700">{loadError}</p> : null}

      <div className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
        <p className="text-sm text-slate-600">
          Partner details (payments, address, pickup) are still edited from the{" "}
          <Link
            href={routes.admin.partners()}
            className="font-medium text-emerald-700 underline underline-offset-2"
          >
            Partners list
          </Link>
          . This page manages physical structure for{" "}
          <span className="font-semibold text-emerald-950">{partner.name}</span>.
        </p>
      </div>

      <AdminManagementSection
        id="pockets"
        title="Pockets"
        description={`Physical areas inside ${partner.name}. Open a pocket to see its POS spots.`}
        actions={
          <button
            type="button"
            onClick={openCreatePocket}
            className="rounded-full bg-emerald-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-900"
          >
            Add pocket
          </button>
        }
      >
        {pockets.length === 0 && unassignedSpots.length === 0 ? (
          <AdminEmptyState
            message="No pockets yet for this partner."
            action={
              <button
                type="button"
                onClick={openCreatePocket}
                className="text-sm font-medium text-emerald-700 underline underline-offset-2"
              >
                Add pocket
              </button>
            }
          />
        ) : (
          <ul className="space-y-2">
            {pockets.map((pocket) => {
              const spots = spotsByPocketId.get(pocket.id) ?? [];
              return (
                <li key={pocket.id}>
                  <ExpandablePocketCard
                    title={pocket.name}
                    subtitle={`${spots.length} POS spot${spots.length === 1 ? "" : "s"}`}
                    spots={spots}
                    onEditSpot={openEditSpot}
                    onArchiveSpot={(spot) => {
                      setArchiveError(null);
                      setArchiveTarget(spot);
                    }}
                    actions={
                      <>
                        <button
                          type="button"
                          onClick={() => openEditPocket(pocket)}
                          className="text-xs font-medium text-emerald-700 underline underline-offset-2"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeletePocketError(null);
                            setDeletePocketTarget(pocket);
                          }}
                          className="text-xs font-medium text-red-700 underline underline-offset-2"
                        >
                          Delete
                        </button>
                      </>
                    }
                  />
                </li>
              );
            })}
            {unassignedSpots.length > 0 ? (
              <li>
                <ExpandablePocketCard
                  title="Unassigned"
                  subtitle={`${unassignedSpots.length} POS spot${unassignedSpots.length === 1 ? "" : "s"}`}
                  spots={unassignedSpots}
                  onEditSpot={openEditSpot}
                  onArchiveSpot={(spot) => {
                    setArchiveError(null);
                    setArchiveTarget(spot);
                  }}
                />
              </li>
            ) : null}
          </ul>
        )}
      </AdminManagementSection>

      <AdminManagementSection
        id="pos-spots"
        title="POS Spots"
        description={`All POS spots for ${partner.name}. Change pocket assignment without affecting QR URLs.`}
        actions={
          <button
            type="button"
            onClick={openCreateSpot}
            className="rounded-full bg-emerald-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-900"
          >
            Add POS Spot
          </button>
        }
      >
        <AdminEntityList
          emptyMessage="No POS spots yet for this partner."
          emptyAction={
            <button
              type="button"
              onClick={openCreateSpot}
              className="text-sm font-medium text-emerald-700 underline underline-offset-2"
            >
              Add POS Spot
            </button>
          }
          items={posSpots.map((spot) => {
            const pocketLabel = resolvePosSpotPocketLabel({
              pocketName: spot.pocketId ? pocketNameById.get(spot.pocketId) : undefined,
              pocket: spot.pocket,
              pocketOther: spot.pocketOther,
            });
            return {
              id: spot.id,
              title: spot.spotName,
              meta: (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${posSpotStatusClassName(spot.status)}`}
                >
                  {posSpotStatusLabel(spot.status)}
                </span>
              ),
              details: (
                <dl className="grid gap-1 text-sm">
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="font-medium text-slate-500">Display</dt>
                    <dd className="text-slate-900">{spot.posName}</dd>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="font-medium text-slate-500">Pocket</dt>
                    <dd className="text-slate-900">{pocketLabel}</dd>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="font-medium text-slate-500">Slug</dt>
                    <dd className="font-mono text-xs text-slate-900">{spot.spotSlug}</dd>
                  </div>
                </dl>
              ),
              actions: (
                <>
                  <Link
                    href={posSpotPath(spot.spotSlug)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-emerald-700 underline underline-offset-2"
                  >
                    Open
                  </Link>
                  <button
                    type="button"
                    onClick={() => openEditSpot(spot)}
                    className="text-xs font-medium text-emerald-700 underline underline-offset-2"
                  >
                    Edit
                  </button>
                  {spot.status !== "inactive" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setArchiveError(null);
                        setArchiveTarget(spot);
                      }}
                      className="text-xs font-medium text-red-700 underline underline-offset-2"
                    >
                      Delete
                    </button>
                  ) : null}
                </>
              ),
            };
          })}
        />
      </AdminManagementSection>

      <AdminFormModal
        open={pocketModal !== null}
        title={pocketModal === "edit" ? "Edit pocket" : "Add pocket"}
        onCancel={() => setPocketModal(null)}
        onSubmit={() => void savePocket()}
        busy={pocketBusy}
        error={pocketError}
        canSubmit={Boolean(pocketNameDraft.trim())}
      >
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">Name</span>
          <input
            value={pocketNameDraft}
            onChange={(e) => setPocketNameDraft(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
            placeholder="e.g. Entrance, Main Counter"
          />
        </label>
      </AdminFormModal>

      <AdminConfirmDialog
        open={Boolean(deletePocketTarget)}
        title="Delete this Pocket?"
        message={
          deletePocketTarget
            ? (assignedCounts.get(deletePocketTarget.id) ?? 0) > 0
              ? `This Pocket contains ${assignedCounts.get(deletePocketTarget.id)} POS Spot${
                  (assignedCounts.get(deletePocketTarget.id) ?? 0) === 1 ? "" : "s"
                }.
Deleting it will also remove the POS Spots currently assigned to it from active use (they become inactive and Unassigned). Their QR codes and historical order data are preserved.

This action cannot be undone.`
              : `Delete “${deletePocketTarget.name}”? This Pocket has no assigned POS Spots.`
            : ""
        }
        confirmLabel="Delete Pocket"
        destructive
        busy={deletePocketBusy}
        error={deletePocketError}
        onCancel={() => setDeletePocketTarget(null)}
        onConfirm={() => void confirmDeletePocket()}
      />

      <AdminFormModal
        open={createSpotOpen}
        title={editSpot ? "Edit POS Spot" : "Add POS Spot"}
        onCancel={() => {
          setCreateSpotOpen(false);
          setEditSpot(null);
        }}
        onSubmit={() => void saveSpot()}
        busy={spotBusy}
        error={spotError}
        canSubmit={Boolean(posNumber.trim() && currentOfferId.trim())}
        submitLabel={editSpot ? "Save" : "Create"}
      >
        <p className="text-sm text-slate-600">
          Partner: <span className="font-semibold text-emerald-950">{partner.name}</span>
        </p>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">POS number</span>
          <input
            value={posNumber}
            onChange={(e) => setPosNumber(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">Pocket</span>
          <select
            value={pocketId}
            onChange={(e) => setPocketId(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
          >
            <option value="">Unassigned</option>
            {pockets.map((pocket) => (
              <option key={pocket.id} value={pocket.id}>
                {pocket.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">Offer</span>
          <select
            value={currentOfferId}
            onChange={(e) => setCurrentOfferId(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
          >
            <option value="">Select offer…</option>
            {offers.map((offer) => (
              <option key={offer.id} value={offer.id}>
                {offer.productName}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">Status</span>
          <select
            value={spotStatus}
            onChange={(e) => setSpotStatus(e.target.value as PosSpotStatus)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
          >
            <option value="available">Available</option>
            <option value="sold">Unavailable</option>
            <option value="held_for_payment">Held for payment</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">Description (optional)</span>
          <input
            value={spotDescription}
            onChange={(e) => setSpotDescription(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
          />
        </label>
        {!editSpot ? (
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Placement notes (optional)</span>
            <input
              value={placementNotes}
              onChange={(e) => setPlacementNotes(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
            />
          </label>
        ) : null}

        {previewIdentity.spotSlug ? (
          <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
            <p className="text-xs font-medium text-slate-500">
              {editSpot
                ? "QR / slug stay fixed when pocket changes"
                : "QR preview — partner + spot number only (pocket is not in the URL)"}
            </p>
            <p className="mt-1 font-mono text-xs text-slate-900">{previewIdentity.spotSlug}</p>
            <p className="mt-1 text-sm text-slate-700">{previewIdentity.posName}</p>
            {fullUrl ? (
              <div className="mt-3 flex flex-col items-start gap-2">
                <div ref={qrHostRef} className="rounded-xl bg-white p-2">
                  <QRCode value={fullUrl} size={112} fgColor="#000000" bgColor="transparent" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopyUrl()}
                    className="text-xs font-medium text-emerald-700 underline underline-offset-2"
                  >
                    Copy URL
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadQr}
                    className="text-xs font-medium text-emerald-700 underline underline-offset-2"
                  >
                    Download QR
                  </button>
                  {copyHint ? <span className="text-xs text-slate-500">{copyHint}</span> : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </AdminFormModal>

      <AdminConfirmDialog
        open={Boolean(archiveTarget)}
        title="Deactivate POS Spot?"
        message={
          archiveTarget
            ? `“${archiveTarget.spotName}” will be set to inactive. Historical orders and the QR slug are preserved.`
            : ""
        }
        confirmLabel="Deactivate"
        destructive
        busy={archiveBusy}
        error={archiveError}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => void confirmArchiveSpot()}
      />
    </div>
  );
}
