"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import QRCode from "react-qr-code";

import type { PartnerLocation } from "@/lib/mockLocations";
import { formatPrice } from "@/lib/mockPlants";
import { POS_SPOT_POCKETS, type PosSpotPocketValue } from "@/lib/posSpotPocket";
import { buildPosSpotNameAndSlug } from "@/lib/posSpotSlugUtils";
import { absoluteAppUrl, getClientOrigin, posSpotPath, routes } from "@/lib/routes";

type OfferOption = {
  id: string;
  productId: string;
  productName: string;
  consumerPrice: number;
  currency: "ILS" | "USD" | "EUR";
  status: "active" | "inactive";
};

type PosSpotStatus = "available" | "sold" | "inactive";

function subscribeToNothing(): () => void {
  return () => {};
}

function useClientOrigin(): string {
  return useSyncExternalStore(subscribeToNothing, getClientOrigin, () => "");
}

export function AdminQrGenerator() {
  const qrHostRef = useRef<HTMLDivElement>(null);
  const origin = useClientOrigin();
  const [offers, setOffers] = useState<OfferOption[]>([]);
  const [locations, setLocations] = useState<PartnerLocation[]>([]);
  const [currentOfferId, setCurrentOfferId] = useState("");
  const [partnerLocationId, setPartnerLocationId] = useState("");
  const [posNumber, setPosNumber] = useState("");
  const [pocket, setPocket] = useState<PosSpotPocketValue | "">("");
  const [pocketOther, setPocketOther] = useState("");
  const [spotDescription, setSpotDescription] = useState("");
  const [placementNotes, setPlacementNotes] = useState("");
  const [status, setStatus] = useState<PosSpotStatus>("available");
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pocketOtherError, setPocketOtherError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      const res = await fetch(routes.api.posSpots(), { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        offers?: OfferOption[];
        locations?: PartnerLocation[];
      };
      if (cancelled) return;
      const activeOffers = (data.offers ?? []).filter((offer) => offer.status === "active");
      const nextLocations = data.locations ?? [];
      setOffers(activeOffers);
      setLocations(nextLocations);
      setPartnerLocationId((prev) => prev || nextLocations[0]?.id || "");
      setCurrentOfferId((prev) => prev || activeOffers[0]?.id || "");
    }
    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  const location = locations.find((l) => l.id === partnerLocationId);

  const { spotName, spotSlug } = useMemo(() => {
    if (!location?.name || !posNumber.trim() || !pocket) {
      return { spotName: "", spotSlug: "" };
    }
    if (pocket === "other" && !pocketOther.trim()) {
      return { spotName: "", spotSlug: "" };
    }
    return buildPosSpotNameAndSlug(location.name, posNumber, pocket, pocketOther);
  }, [location?.name, posNumber, pocket, pocketOther]);

  const relativePath = useMemo(() => (spotSlug ? posSpotPath(spotSlug) : ""), [spotSlug]);
  const fullUrl = origin && relativePath ? absoluteAppUrl(origin, relativePath) : "";

  const offer = offers.find((item) => item.id === currentOfferId);
  const pocketLabel =
    pocket === "other"
      ? pocketOther.trim() || "Other"
      : POS_SPOT_POCKETS.find((p) => p.value === pocket)?.label ?? "";

  const canSave = Boolean(
    partnerLocationId.trim() &&
      currentOfferId.trim() &&
      posNumber.trim() &&
      pocket &&
      (pocket !== "other" || pocketOther.trim()) &&
      spotSlug.trim() &&
      !isSaving,
  );

  function resetForm() {
    setPosNumber("");
    setPocket("");
    setPocketOther("");
    setSpotDescription("");
    setPlacementNotes("");
    setStatus("available");
    setPartnerLocationId(locations[0]?.id ?? "");
    setCurrentOfferId(offers[0]?.id ?? "");
    setPocketOtherError(false);
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
    if (!svg) return;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    if (!clone.getAttribute("xmlns")) {
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }

    const serializer = new XMLSerializer();
    const source = `<?xml version="1.0" encoding="UTF-8"?>\n${serializer.serializeToString(clone)}`;
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const safeSlug = spotSlug.replace(/[^a-zA-Z0-9_-]/g, "");
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = `urban-plant-qr-${safeSlug}.svg`;
    anchor.click();
    URL.revokeObjectURL(blobUrl);
  }

  async function handleSavePosSpot() {
    if (pocket === "other" && !pocketOther.trim()) {
      setPocketOtherError(true);
      setSaveHint("Custom pocket description is required when Other is selected.");
      return;
    }
    if (!canSave) return;
    setIsSaving(true);
    setSaveHint(null);
    try {
      const res = await fetch(routes.api.posSpots(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerLocationId,
          posNumber: posNumber.trim(),
          pocket,
          ...(pocket === "other" ? { pocketOther: pocketOther.trim() } : {}),
          ...(spotDescription.trim() ? { spotDescription: spotDescription.trim() } : {}),
          placementNotes: placementNotes.trim(),
          currentOfferId,
          status,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setSaveHint(data.error ?? "Could not save POS Spot");
        return;
      }
      setSaveHint("POS Spot saved");
      resetForm();
    } catch {
      setSaveHint("Network error. Try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
        <h2 className="text-lg font-semibold text-emerald-950">Create POS Spot QR</h2>
        <p className="mt-1 text-sm text-slate-600">
          The QR encodes a stable POS Spot URL only. Product data is loaded through the selected
          Offer.
        </p>

        <div className="mt-5 grid gap-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Partner Location</span>
            <select
              value={partnerLocationId}
              onChange={(e) => setPartnerLocationId(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id} className="text-slate-900">
                  {loc.name} — {loc.partnerType}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Existing Offer</span>
            <select
              value={currentOfferId}
              onChange={(e) => setCurrentOfferId(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            >
              {offers.map((item) => (
                <option key={item.id} value={item.id} className="text-slate-900">
                  {item.productName} ({formatPrice(item.consumerPrice, item.currency)})
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">POS Spot number</span>
            <input
              value={posNumber}
              onChange={(e) => setPosNumber(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
              placeholder="3"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Pocket</span>
            <select
              value={pocket}
              onChange={(e) => {
                setPocket(e.target.value as PosSpotPocketValue | "");
                if (e.target.value !== "other") setPocketOtherError(false);
              }}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            >
              <option value="" className="text-slate-900">
                Select pocket…
              </option>
              {POS_SPOT_POCKETS.map((item) => (
                <option key={item.value} value={item.value} className="text-slate-900">
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          {pocket === "other" ? (
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">Custom pocket</span>
              <input
                value={pocketOther}
                onChange={(e) => {
                  setPocketOther(e.target.value);
                  if (e.target.value.trim()) setPocketOtherError(false);
                }}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
                placeholder="Describe the placement"
                aria-invalid={pocketOtherError && !pocketOther.trim()}
              />
              {pocketOtherError && !pocketOther.trim() ? (
                <span className="text-sm text-red-700">Custom pocket is required.</span>
              ) : null}
            </label>
          ) : null}

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">POS Description (optional)</span>
            <input
              value={spotDescription}
              onChange={(e) => setSpotDescription(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
              placeholder="Extra notes for staff — not used in the slug"
            />
          </label>

          <div className="rounded-2xl bg-slate-50/80 px-3 py-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Auto-generated identifiers
            </p>
            <div className="space-y-1 text-sm">
              {spotName ? (
                <p>
                  <span className="font-medium text-slate-500">Spot name </span>
                  <span className="font-mono text-slate-900">{spotName}</span>
                </p>
              ) : null}
              {spotSlug ? (
                <p>
                  <span className="font-medium text-slate-500">Spot slug </span>
                  <span className="font-mono text-slate-900">{spotSlug}</span>
                </p>
              ) : null}
            </div>
            <span className="text-xs text-slate-500">
              Built from partner name, spot number, and pocket ({pocketLabel || "select pocket"}).
            </span>
          </div>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Initial POS Spot status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as PosSpotStatus)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            >
              <option value="available" className="text-slate-900">
                Available
              </option>
              <option value="sold" className="text-slate-900">
                Sold
              </option>
              <option value="inactive" className="text-slate-900">
                Inactive
              </option>
            </select>
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Placement notes</span>
            <textarea
              value={placementNotes}
              onChange={(e) => setPlacementNotes(e.target.value)}
              rows={3}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
              placeholder="Optional notes"
            />
          </label>

          <button
            type="button"
            onClick={() => void handleSavePosSpot()}
            disabled={!canSave}
            className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save POS Spot"}
          </button>
          {saveHint ? <span className="text-sm text-emerald-800">{saveHint}</span> : null}
        </div>
      </div>

      <div className="rounded-3xl bg-emerald-50/40 p-5">
        <h2 className="text-lg font-semibold text-emerald-950">Preview</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-slate-500">Offer</dt>
            <dd className="text-slate-900">{offer?.productName ?? currentOfferId}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-slate-500">Location</dt>
            <dd className="text-slate-900">{location?.name ?? partnerLocationId}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-slate-500">Spot number</dt>
            <dd className="text-slate-900">{posNumber || "—"}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-slate-500">Pocket</dt>
            <dd className="text-slate-900">{pocketLabel || "—"}</dd>
          </div>
          {spotName ? (
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-slate-500">Spot name</dt>
              <dd className="font-mono text-slate-900">{spotName}</dd>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-slate-500">POS Description</dt>
            <dd className="text-slate-900">{spotDescription || "—"}</dd>
          </div>
          <div className="pt-2">
            <dt className="font-medium text-slate-500">Generated URL</dt>
            <dd className="mt-1 break-all rounded-xl bg-white px-3 py-2 font-mono text-xs text-slate-800 ring-1 ring-emerald-100">
              {fullUrl || `${relativePath} (full URL loads after page mounts)`}
            </dd>
          </div>
        </dl>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={() => void handleCopyUrl()}
            disabled={!fullUrl}
            className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Copy URL
          </button>
          <button
            type="button"
            onClick={handleDownloadQr}
            disabled={!fullUrl}
            className="rounded-xl border border-emerald-300 bg-white px-4 py-3 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download QR (SVG)
          </button>
          {copyHint ? <span className="self-center text-sm text-emerald-800">{copyHint}</span> : null}
        </div>

        <div className="mt-6 flex justify-center rounded-2xl bg-white p-6 ring-1 ring-emerald-100">
          <div ref={qrHostRef} className="w-full max-w-[240px]">
            {fullUrl ? (
              <QRCode
                value={fullUrl}
                size={240}
                style={{ height: "auto", maxWidth: "100%", width: "100%" }}
              />
            ) : (
              <div className="flex aspect-square items-center justify-center rounded-xl bg-emerald-50 text-center text-sm text-slate-600">
                Preparing QR…
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-slate-500">
        <Link href={routes.admin.orders()} className="font-medium text-emerald-700 underline underline-offset-2">
          Back to orders
        </Link>
      </p>
    </div>
  );
}
