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
import { useLocale } from "@/components/locale/LocaleProvider";
import { formatStoredDeliveryAddressDisplay } from "@/lib/deliveryAddress";
import {
  adminHeldForPaymentLabel,
  displayApiError,
  posSpotAdminAvailabilityLabel,
} from "@/lib/displayLabels";
import type { Locale } from "@/lib/locale";
import { t } from "@/lib/messages";
import type { PartnerLocation } from "@/lib/partnerLocationStorage";
import type { Pocket } from "@/lib/pocketTypes";
import { resolvePosSpotPocketLabel } from "@/lib/posSpotPocket";
import type { PosSpot, PosSpotStatus } from "@/lib/posSpotTypes";
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
  locale,
  spot,
  offerName,
  onEdit,
  onArchive,
}: {
  locale: Locale;
  spot: PosSpot;
  offerName: string;
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
              {posSpotAdminAvailabilityLabel(locale, spot.status)}
            </span>
          </div>
          <dl className="mt-2 grid gap-1">
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-slate-500">{t(locale, "admin.common.offer")}</dt>
              <dd className="text-slate-900">{offerName}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-slate-500">
                {t(locale, "admin.partners.detail.slug")}
              </dt>
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
            {t(locale, "admin.common.open")}
          </Link>
          <button
            type="button"
            onClick={onEdit}
            className="text-xs font-medium text-emerald-700 underline underline-offset-2"
          >
            {t(locale, "admin.common.edit")}
          </button>
          {spot.status !== "inactive" ? (
            <button
              type="button"
              onClick={onArchive}
              className="text-xs font-medium text-red-700 underline underline-offset-2"
            >
              {t(locale, "admin.common.delete")}
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function ExpandablePocketCard({
  locale,
  title,
  subtitle,
  spots,
  offerNameById,
  actions,
  onEditSpot,
  onArchiveSpot,
}: {
  locale: Locale;
  title: string;
  subtitle: string;
  spots: PosSpot[];
  offerNameById: Map<string, string>;
  actions?: ReactNode;
  onEditSpot: (spot: PosSpot) => void | Promise<void>;
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
            <p className="text-sm text-slate-500">
              {t(locale, "admin.partners.detail.noPocketsInPocket")}
            </p>
          ) : (
            <ul className="space-y-2">
              {spots.map((spot) => (
                <PocketSpotRow
                  key={spot.id}
                  locale={locale}
                  spot={spot}
                  offerName={offerNameById.get(spot.currentOfferId) ?? "—"}
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
  const locale = useLocale();
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

  const offerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const offer of offers) map.set(offer.id, offer.productName);
    return map;
  }, [offers]);

  const activeOffers = useMemo(
    () => offers.filter((offer) => offer.status === "active"),
    [offers],
  );

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

      if (!partnersRes.ok) {
        const data = (await partnersRes.json().catch(() => ({}))) as { error?: string };
        setLoadError(
          displayApiError(locale, data.error, "admin.partners.detail.loadPartnersFailed"),
        );
        return;
      }
      if (!pocketsRes.ok) {
        const data = (await pocketsRes.json().catch(() => ({}))) as { error?: string };
        setLoadError(
          displayApiError(locale, data.error, "admin.partners.detail.loadPocketsFailed"),
        );
        return;
      }
      if (!spotsRes.ok) {
        const data = (await spotsRes.json().catch(() => ({}))) as { error?: string };
        setLoadError(displayApiError(locale, data.error, "admin.partners.detail.loadSpotsFailed"));
        return;
      }

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
        setLoadError(t(locale, "admin.partners.detail.notFound"));
        return;
      }

      setPartner(found);
      setPockets(pocketsData.pockets ?? []);
      setPosSpots(spotsData.posSpots ?? []);
      setOffers(spotsData.offers ?? []);
    } catch {
      setLoadError(displayApiError(locale, undefined, "admin.partners.detail.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [partnerId, locale]);

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

  function spotCountSubtitle(count: number): string {
    return count === 1
      ? t(locale, "admin.partners.detail.spotCountOne")
      : t(locale, "admin.partners.detail.spotCountMany", { count });
  }

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
      setPocketError(t(locale, "validation.required"));
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
        setPocketError(displayApiError(locale, data.error, "admin.partners.detail.pocketSaveFailed"));
        return;
      }
      setPocketModal(null);
      await loadAll();
    } catch {
      setPocketError(displayApiError(locale, undefined, "admin.partners.detail.pocketSaveFailed"));
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
        setDeletePocketError(
          displayApiError(locale, data.error, "admin.partners.detail.pocketDeleteFailed"),
        );
        return;
      }
      setDeletePocketTarget(null);
      await loadAll();
    } catch {
      setDeletePocketError(
        displayApiError(locale, undefined, "admin.partners.detail.pocketDeleteFailed"),
      );
    } finally {
      setDeletePocketBusy(false);
    }
  }

  function openCreateSpot() {
    setEditSpot(null);
    setPosNumber(suggestNextPosNumber(posSpots.map((s) => s.posNumber)));
    setPocketId("");
    setCurrentOfferId(activeOffers[0]?.id ?? "");
    setSpotDescription("");
    setPlacementNotes("");
    setSpotStatus("available");
    setSpotError(null);
    setCreateSpotOpen(true);
  }

  function applySpotToEditForm(spot: PosSpot) {
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
  }

  async function openEditSpot(spot: PosSpot) {
    setSpotError(null);
    setSpotBusy(true);
    try {
      const res = await fetch(routes.api.posSpot(spot.id), { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        posSpot?: PosSpot;
        error?: string;
      };
      if (!res.ok || !data.posSpot) {
        setLoadError(displayApiError(locale, data.error, "admin.partners.detail.posLoadFailed"));
        return;
      }
      const fresh = data.posSpot;
      setPosSpots((prev) => prev.map((s) => (s.id === fresh.id ? fresh : s)));
      applySpotToEditForm(fresh);
      setCreateSpotOpen(true);
    } catch {
      setLoadError(displayApiError(locale, undefined, "admin.partners.detail.posLoadFailed"));
    } finally {
      setSpotBusy(false);
    }
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
      setSpotError(t(locale, "admin.partners.detail.posNumberRequired"));
      return;
    }
    if (!currentOfferId.trim()) {
      setSpotError(t(locale, "admin.partners.detail.offerRequired"));
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
          setSpotError(displayApiError(locale, data.error, "admin.partners.detail.posUpdateFailed"));
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
          setSpotError(displayApiError(locale, data.error, "admin.partners.detail.posCreateFailed"));
          return;
        }
      }
      setCreateSpotOpen(false);
      setEditSpot(null);
      await loadAll();
    } catch {
      setSpotError(displayApiError(locale, undefined, "admin.partners.detail.posSaveFailed"));
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
        setArchiveError(
          displayApiError(locale, data.error, "admin.partners.detail.posDeactivateFailed"),
        );
        return;
      }
      setArchiveTarget(null);
      await loadAll();
    } catch {
      setArchiveError(
        displayApiError(locale, undefined, "admin.partners.detail.posDeactivateFailed"),
      );
    } finally {
      setArchiveBusy(false);
    }
  }

  async function handleCopyUrl() {
    if (!fullUrl) return;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopyHint(t(locale, "admin.common.copied"));
      window.setTimeout(() => setCopyHint(null), 2000);
    } catch {
      setCopyHint(t(locale, "admin.common.copyFailed"));
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
    return <p className="text-sm text-slate-600">{t(locale, "admin.partners.detail.loading")}</p>;
  }

  if (!partner) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-700">
          {loadError ?? t(locale, "admin.partners.detail.notFound")}
        </p>
        <Link
          href={routes.admin.partners()}
          className="text-sm font-medium text-emerald-700 underline underline-offset-2"
        >
          {t(locale, "admin.partners.detail.back")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
            {t(locale, "admin.common.partner")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-emerald-950">{partner.name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {formatStoredDeliveryAddressDisplay(partner.address, locale)}
          </p>
          <p className="mt-0.5 text-sm text-slate-500">{partner.type}</p>
        </div>
        <Link
          href={routes.admin.partners()}
          className="text-sm font-medium text-emerald-700 underline underline-offset-2"
        >
          {t(locale, "admin.partners.detail.allPartners")}
        </Link>
      </div>

      {loadError ? <p className="text-sm text-red-700">{loadError}</p> : null}

      <div className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
        <p className="text-sm text-slate-600">
          {t(locale, "admin.partners.detail.editHintBefore")}
          <Link
            href={routes.admin.partners()}
            className="font-medium text-emerald-700 underline underline-offset-2"
          >
            {t(locale, "admin.partners.detail.editHintLink")}
          </Link>
          {t(locale, "admin.partners.detail.editHintAfter")}
          <span className="font-semibold text-emerald-950">{partner.name}</span>.
        </p>
      </div>

      <AdminManagementSection
        id="pockets"
        title={t(locale, "admin.partners.detail.pockets")}
        description={t(locale, "admin.partners.detail.pocketsDesc", { name: partner.name })}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openCreatePocket}
              className="rounded-full bg-emerald-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-900"
            >
              {t(locale, "admin.partners.detail.addPocket")}
            </button>
          </div>
        }
      >
        {pockets.length === 0 && unassignedSpots.length === 0 ? (
          <AdminEmptyState
            message={t(locale, "admin.partners.detail.noPockets")}
            action={
              <button
                type="button"
                onClick={openCreatePocket}
                className="text-sm font-medium text-emerald-700 underline underline-offset-2"
              >
                {t(locale, "admin.partners.detail.addPocket")}
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
                    locale={locale}
                    title={pocket.name}
                    subtitle={spotCountSubtitle(spots.length)}
                    spots={spots}
                    offerNameById={offerNameById}
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
                          {t(locale, "admin.common.edit")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeletePocketError(null);
                            setDeletePocketTarget(pocket);
                          }}
                          className="text-xs font-medium text-red-700 underline underline-offset-2"
                        >
                          {t(locale, "admin.common.delete")}
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
                  locale={locale}
                  title={t(locale, "admin.partners.detail.unassigned")}
                  subtitle={spotCountSubtitle(unassignedSpots.length)}
                  spots={unassignedSpots}
                  offerNameById={offerNameById}
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
        title={t(locale, "admin.partners.detail.posSpots")}
        description={t(locale, "admin.partners.detail.posSpotsDesc", { name: partner.name })}
        actions={
          <button
            type="button"
            onClick={openCreateSpot}
            className="rounded-full bg-emerald-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-900"
          >
            {t(locale, "admin.partners.detail.addPosSpot")}
          </button>
        }
      >
        <AdminEntityList
          emptyMessage={t(locale, "admin.partners.detail.noPosSpots")}
          emptyAction={
            <button
              type="button"
              onClick={openCreateSpot}
              className="text-sm font-medium text-emerald-700 underline underline-offset-2"
            >
              {t(locale, "admin.partners.detail.addPosSpot")}
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
                  {posSpotAdminAvailabilityLabel(locale, spot.status)}
                </span>
              ),
              details: (
                <dl className="grid gap-1 text-sm">
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="font-medium text-slate-500">{t(locale, "admin.common.offer")}</dt>
                    <dd className="text-slate-900">
                      {offerNameById.get(spot.currentOfferId) ?? "—"}
                    </dd>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="font-medium text-slate-500">{t(locale, "admin.common.pocket")}</dt>
                    <dd className="text-slate-900">{pocketLabel}</dd>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="font-medium text-slate-500">
                      {t(locale, "admin.partners.detail.slug")}
                    </dt>
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
                    {t(locale, "admin.common.open")}
                  </Link>
                  <button
                    type="button"
                    onClick={() => openEditSpot(spot)}
                    className="text-xs font-medium text-emerald-700 underline underline-offset-2"
                  >
                    {t(locale, "admin.common.edit")}
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
                      {t(locale, "admin.common.delete")}
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
        title={
          pocketModal === "edit"
            ? t(locale, "admin.partners.detail.editPocket")
            : t(locale, "admin.partners.detail.addPocket")
        }
        onCancel={() => setPocketModal(null)}
        onSubmit={() => void savePocket()}
        busy={pocketBusy}
        error={pocketError}
        canSubmit={Boolean(pocketNameDraft.trim())}
      >
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">{t(locale, "admin.common.name")}</span>
          <input
            value={pocketNameDraft}
            onChange={(e) => setPocketNameDraft(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
            placeholder={t(locale, "admin.partners.detail.pocketPlaceholder")}
          />
        </label>
      </AdminFormModal>

      <AdminConfirmDialog
        open={Boolean(deletePocketTarget)}
        title={t(locale, "admin.partners.detail.deletePocketTitle")}
        message={
          deletePocketTarget
            ? (assignedCounts.get(deletePocketTarget.id) ?? 0) > 0
              ? t(locale, "admin.partners.detail.deletePocketWithSpots", {
                  count: assignedCounts.get(deletePocketTarget.id) ?? 0,
                })
              : t(locale, "admin.partners.detail.deletePocketEmpty", {
                  name: deletePocketTarget.name,
                })
            : ""
        }
        confirmLabel={t(locale, "admin.partners.detail.deletePocketConfirm")}
        destructive
        busy={deletePocketBusy}
        error={deletePocketError}
        onCancel={() => setDeletePocketTarget(null)}
        onConfirm={() => void confirmDeletePocket()}
      />

      <AdminFormModal
        open={createSpotOpen}
        title={
          editSpot
            ? t(locale, "admin.partners.detail.editPosSpot")
            : t(locale, "admin.partners.detail.addPosSpotModal")
        }
        onCancel={() => {
          setCreateSpotOpen(false);
          setEditSpot(null);
        }}
        onSubmit={() => void saveSpot()}
        busy={spotBusy}
        error={spotError}
        canSubmit={Boolean(posNumber.trim() && currentOfferId.trim())}
        submitLabel={
          editSpot ? t(locale, "admin.shared.save") : t(locale, "admin.shared.create")
        }
      >
        <p className="text-sm text-slate-600">
          {t(locale, "admin.partners.detail.partnerLabel")}{" "}
          <span className="font-semibold text-emerald-950">{partner.name}</span>
        </p>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">
            {t(locale, "admin.partners.detail.posNumber")}
          </span>
          <input
            value={posNumber}
            onChange={(e) => setPosNumber(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">{t(locale, "admin.common.pocket")}</span>
          <select
            value={pocketId}
            onChange={(e) => setPocketId(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
          >
            <option value="">{t(locale, "admin.partners.detail.unassignedOption")}</option>
            {pockets.map((pocket) => (
              <option key={pocket.id} value={pocket.id}>
                {pocket.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">{t(locale, "admin.common.offer")}</span>
          <select
            value={currentOfferId}
            onChange={(e) => setCurrentOfferId(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
          >
            <option value="">{t(locale, "admin.partners.detail.selectOffer")}</option>
            {activeOffers.map((offer) => (
              <option key={offer.id} value={offer.id}>
                {offer.productName}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">{t(locale, "admin.common.status")}</span>
          <select
            value={spotStatus}
            onChange={(e) => setSpotStatus(e.target.value as PosSpotStatus)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
          >
            <option value="available">{posSpotAdminAvailabilityLabel(locale, "available")}</option>
            <option value="sold">{posSpotAdminAvailabilityLabel(locale, "sold")}</option>
            <option value="held_for_payment">{adminHeldForPaymentLabel(locale)}</option>
            <option value="inactive">{posSpotAdminAvailabilityLabel(locale, "inactive")}</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">
            {t(locale, "admin.partners.detail.descriptionOptional")}
          </span>
          <input
            value={spotDescription}
            onChange={(e) => setSpotDescription(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
          />
        </label>
        {!editSpot ? (
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">
              {t(locale, "admin.partners.detail.placementNotesOptional")}
            </span>
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
                ? t(locale, "admin.partners.detail.qrSlugFixed")
                : t(locale, "admin.partners.detail.qrPreview")}
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
                    {t(locale, "admin.partners.detail.copyUrl")}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadQr}
                    className="text-xs font-medium text-emerald-700 underline underline-offset-2"
                  >
                    {t(locale, "admin.partners.detail.downloadQr")}
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
        title={t(locale, "admin.partners.detail.deactivateTitle")}
        message={
          archiveTarget
            ? t(locale, "admin.partners.detail.deactivateMessage", { name: archiveTarget.spotName })
            : ""
        }
        confirmLabel={t(locale, "admin.shared.deactivate")}
        destructive
        busy={archiveBusy}
        error={archiveError}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => void confirmArchiveSpot()}
      />
    </div>
  );
}
