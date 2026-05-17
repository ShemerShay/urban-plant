"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import QRCode from "react-qr-code";

import { locations } from "@/lib/mockLocations";
import { formatPrice } from "@/lib/mockPlants";
import { posSpotPath } from "@/lib/qrNavigation";

type OfferOption = {
  id: string;
  productId: string;
  productName: string;
  consumerPrice: number;
  currency: "ILS" | "USD" | "EUR";
  status: "active" | "inactive";
};

type PosSpotStatus = "available" | "sold" | "inactive";

function clientOriginSnapshot(): string {
  return `${window.location.protocol}//${window.location.host}`;
}

function subscribeToNothing(): () => void {
  return () => {};
}

function useClientOrigin(): string {
  return useSyncExternalStore(subscribeToNothing, clientOriginSnapshot, () => "");
}

export function AdminQrGenerator() {
  const qrHostRef = useRef<HTMLDivElement>(null);
  const origin = useClientOrigin();
  const [offers, setOffers] = useState<OfferOption[]>([]);
  const [currentOfferId, setCurrentOfferId] = useState("");
  const [partnerLocationId, setPartnerLocationId] = useState(locations[0]?.id ?? "");
  const [posNumber, setPosNumber] = useState("");
  const [spotDescription, setSpotDescription] = useState("");
  const [placementNotes, setPlacementNotes] = useState("");
  const [spotSlug, setSpotSlug] = useState("");
  const [status, setStatus] = useState<PosSpotStatus>("available");
  const [placedAt, setPlacedAt] = useState("");
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      const res = await fetch("/api/pos-spots", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { offers?: OfferOption[] };
      if (cancelled) return;
      const activeOffers = (data.offers ?? []).filter((offer) => offer.status === "active");
      setOffers(activeOffers);
      setCurrentOfferId((prev) => prev || activeOffers[0]?.id || "");
    }
    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  function slugify(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function handlePartnerChange(next: string) {
    setPartnerLocationId(next);
    if (!spotSlug && spotDescription) setSpotSlug(slugify(`${next}-${spotDescription}`));
  }

  function handleDescriptionChange(next: string) {
    setSpotDescription(next);
    if (!spotSlug) setSpotSlug(slugify(`${partnerLocationId}-${next}`));
  }

  const relativePath = useMemo(() => (spotSlug ? posSpotPath(spotSlug) : ""), [spotSlug]);
  const fullUrl = origin && relativePath ? `${origin}${relativePath}` : "";

  const offer = offers.find((item) => item.id === currentOfferId);
  const location = locations.find((l) => l.id === partnerLocationId);
  const canSave = Boolean(
    partnerLocationId.trim() &&
    currentOfferId.trim() &&
    spotDescription.trim() &&
    spotSlug.trim() &&
    !isSaving,
  );

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
    if (!canSave) return;
    setIsSaving(true);
    setSaveHint(null);
    try {
      const res = await fetch("/api/pos-spots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerLocationId,
          posNumber: posNumber.trim(),
          spotDescription: spotDescription.trim(),
          placementNotes: placementNotes.trim(),
          spotSlug: spotSlug.trim(),
          currentOfferId,
          status,
          placedAt: placedAt.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setSaveHint(data.error ?? "Could not save POS Spot");
        return;
      }
      setSaveHint("POS Spot saved");
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
              onChange={(e) => handlePartnerChange(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
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
                <option key={item.id} value={item.id}>
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
              placeholder="1"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">POS Spot description</span>
            <input
              value={spotDescription}
              onChange={(e) => handleDescriptionChange(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
              placeholder="Front window shelf"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Spot slug</span>
            <input
              value={spotSlug}
              onChange={(e) => setSpotSlug(slugify(e.target.value))}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
              placeholder="cafe-nahat-front-window"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Initial POS Spot status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as PosSpotStatus)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            >
              <option value="available">Available</option>
              <option value="sold">Sold</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Placed at</span>
            <input
              value={placedAt}
              onChange={(e) => setPlacedAt(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
              placeholder="Leave empty to use now"
            />
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
            <dt className="font-medium text-slate-500">POS Spot</dt>
            <dd className="text-slate-900">{spotDescription || "Not specified"}</dd>
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
        <Link href="/admin/orders" className="font-medium text-emerald-700 underline underline-offset-2">
          Back to orders
        </Link>
      </p>
    </div>
  );
}
