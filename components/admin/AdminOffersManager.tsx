"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { formatPrice } from "@/lib/mockPlants";
import type { OfferStatus, OfferWithProduct } from "@/lib/offerTypes";
import type { PlantProduct } from "@/lib/types";

type OffersApiResponse = {
  offers?: OfferWithProduct[];
  offer?: OfferWithProduct;
  error?: string;
};

type PlantsApiResponse = {
  plants?: PlantProduct[];
  error?: string;
};

type OfferDraft = {
  productId: string;
  consumerPrice: string;
  supplierPrice: string;
  supplierName: string;
  status: OfferStatus;
};

const STATUS_OPTIONS: OfferStatus[] = ["active", "inactive"];

const inputClassName =
  "mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900";
const labelClassName = "text-xs font-medium text-slate-500";

function offerToDraft(offer: OfferWithProduct): OfferDraft {
  return {
    productId: offer.productId,
    consumerPrice: String(offer.consumerPrice),
    supplierPrice: typeof offer.supplierPrice === "number" ? String(offer.supplierPrice) : "",
    supplierName: offer.supplierName ?? "",
    status: offer.status,
  };
}

function emptyDraft(): OfferDraft {
  return {
    productId: "",
    consumerPrice: "",
    supplierPrice: "",
    supplierName: "",
    status: "active",
  };
}

function draftToPayload(draft: OfferDraft): Record<string, unknown> {
  const consumerPrice = Number(draft.consumerPrice);
  const supplierPriceTrimmed = draft.supplierPrice.trim();
  const supplierPrice =
    supplierPriceTrimmed === "" ? undefined : Number(supplierPriceTrimmed);
  const supplierNameTrimmed = draft.supplierName.trim();

  return {
    productId: draft.productId.trim(),
    consumerPrice,
    ...(supplierPrice !== undefined && Number.isFinite(supplierPrice)
      ? { supplierPrice }
      : { supplierPrice: null }),
    ...(supplierNameTrimmed ? { supplierName: supplierNameTrimmed } : { supplierName: null }),
    status: draft.status,
  };
}

function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPencil({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 20h4l10.5-10.5a2.12 2.12 0 00-3-3L5 17v3zM14.5 6.5l3 3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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

function offerMatchesSearch(offer: OfferWithProduct, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    offer.productId,
    offer.productName,
    offer.plantSubtitle,
    offer.status,
    String(offer.consumerPrice),
    offer.supplierName,
    typeof offer.supplierPrice === "number" ? String(offer.supplierPrice) : "",
    offer.createdAt,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function OfferPlantImage({
  images,
  name,
  size = "md",
}: {
  images: string[];
  name: string;
  size?: "sm" | "md";
}) {
  const src = images[0];
  if (!src) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-500 ${
          size === "sm" ? "h-14 w-14" : "min-h-[5rem] w-full max-w-[8rem]"
        }`}
      >
        No image
      </div>
    );
  }

  const thumbClass =
    size === "sm"
      ? "h-14 w-14 shrink-0 rounded-xl object-cover ring-1 ring-slate-200"
      : "h-28 w-full max-w-[8rem] rounded-xl object-cover ring-1 ring-slate-200 sm:h-32";

  return <img src={src} alt={name} className={thumbClass} />;
}

function PlantSelect({
  plants,
  value,
  onChange,
  required,
}: {
  plants: PlantProduct[];
  value: string;
  onChange: (productId: string) => void;
  required?: boolean;
}) {
  return (
    <select
      className={inputClassName}
      value={value}
      required={required}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Select a plant…</option>
      {plants.map((plant) => (
        <option key={plant.id} value={plant.id}>
          {plant.name} ({plant.id})
        </option>
      ))}
    </select>
  );
}

function OfferFieldsForm({
  draft,
  plants,
  onChange,
}: {
  draft: OfferDraft;
  plants: PlantProduct[];
  onChange: (next: OfferDraft) => void;
}) {
  function patch(partial: Partial<OfferDraft>) {
    onChange({ ...draft, ...partial });
  }

  const selectedPlant = plants.find((p) => p.id === draft.productId);
  const previewImages = selectedPlant?.images ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className={labelClassName}>Plant</span>
          <PlantSelect
            plants={plants}
            value={draft.productId}
            onChange={(productId) => {
              const plant = plants.find((p) => p.id === productId);
              patch({
                productId,
                ...(plant && !draft.consumerPrice
                  ? { consumerPrice: String(plant.price) }
                  : {}),
                ...(plant?.supplierName && !draft.supplierName
                  ? { supplierName: plant.supplierName }
                  : {}),
                ...(typeof plant?.baseSupplierPrice === "number" && !draft.supplierPrice
                  ? { supplierPrice: String(plant.baseSupplierPrice) }
                  : {}),
              });
            }}
            required
          />
        </label>
        {previewImages.length > 0 ? (
          <div className="sm:col-span-2">
            <span className={labelClassName}>Plant image (from catalog)</span>
            <div className="mt-1">
              <OfferPlantImage images={previewImages} name={selectedPlant?.name ?? "Plant"} />
            </div>
          </div>
        ) : null}
        <label className="block">
          <span className={labelClassName}>Consumer price</span>
          <input
            className={inputClassName}
            type="number"
            min={0}
            step={1}
            value={draft.consumerPrice}
            onChange={(e) => patch({ consumerPrice: e.target.value })}
            required
          />
        </label>
        <label className="block">
          <span className={labelClassName}>Supplier price (optional)</span>
          <input
            className={inputClassName}
            type="number"
            min={0}
            step={0.01}
            value={draft.supplierPrice}
            onChange={(e) => patch({ supplierPrice: e.target.value })}
          />
        </label>
        <label className="block">
          <span className={labelClassName}>Supplier name (optional)</span>
          <input
            className={inputClassName}
            value={draft.supplierName}
            onChange={(e) => patch({ supplierName: e.target.value })}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClassName}>Status</span>
          <select
            className={inputClassName}
            value={draft.status}
            onChange={(e) => patch({ status: e.target.value as OfferStatus })}
          >
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

function OfferDetailView({ offer }: { offer: OfferWithProduct }) {
  const missingPlant = offer.productName === offer.productId && offer.plantImages.length === 0;

  return (
    <div>
      <OfferPlantImage images={offer.plantImages} name={offer.productName} />
      {missingPlant ? (
        <p className="mb-4 text-sm text-amber-800">
          No catalog plant found for product id &ldquo;{offer.productId}&rdquo;.
        </p>
      ) : null}
      <dl className="grid gap-2 text-sm">
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">Plant</dt>
          <dd className="text-slate-900">
            {offer.productName}{" "}
            <span className="font-mono text-xs text-slate-500">({offer.productId})</span>
          </dd>
        </div>
        {offer.plantSubtitle ? (
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-slate-500">Plant subtitle</dt>
            <dd className="text-slate-900">{offer.plantSubtitle}</dd>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">Consumer price</dt>
          <dd className="text-slate-900">{formatPrice(offer.consumerPrice, offer.currency)}</dd>
        </div>
        {typeof offer.supplierPrice === "number" ? (
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-slate-500">Supplier price</dt>
            <dd className="text-slate-900">{offer.supplierPrice}</dd>
          </div>
        ) : null}
        {offer.supplierName ? (
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-slate-500">Supplier name</dt>
            <dd className="text-slate-900">{offer.supplierName}</dd>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">Status</dt>
          <dd className="capitalize text-slate-900">{offer.status}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">Created at</dt>
          <dd className="font-mono text-xs text-slate-900">{offer.createdAt}</dd>
        </div>
      </dl>
    </div>
  );
}

function AdminOfferCard({
  offer,
  plants,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaved,
}: {
  offer: OfferWithProduct;
  plants: PlantProduct[];
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaved: (offer: OfferWithProduct) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(() => offerToDraft(offer));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isEditing) setDraft(offerToDraft(offer));
  }, [offer, isEditing]);

  useEffect(() => {
    if (isEditing) setIsOpen(true);
  }, [isEditing]);

  async function handleSave() {
    if (!draft.productId.trim()) {
      setSaveError("Select a plant for this offer.");
      return;
    }
    const consumerPrice = Number(draft.consumerPrice);
    if (!Number.isFinite(consumerPrice) || consumerPrice < 0) {
      setSaveError("Consumer price must be a non-negative number.");
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/offers/${encodeURIComponent(offer.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftToPayload(draft)),
      });
      const data = (await res.json().catch(() => ({}))) as OffersApiResponse;
      if (!res.ok) {
        setSaveError(data.error ?? "Could not save offer");
        return;
      }
      if (data.offer) onSaved(data.offer);
    } catch {
      setSaveError("Network error. Try again.");
    } finally {
      setIsSaving(false);
    }
  }

  const headerImage = offer.plantImages[0];

  return (
    <article className="overflow-hidden rounded-3xl bg-white shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50/80"
          aria-expanded={isOpen}
        >
          {headerImage ? (
            <img
              src={headerImage}
              alt=""
              className="h-14 w-14 shrink-0 rounded-xl object-cover ring-1 ring-slate-200"
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[10px] text-slate-500">
              —
            </div>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold text-emerald-950">
              {offer.productName}
            </span>
            <span className="mt-0.5 block truncate text-sm text-slate-600">
              {formatPrice(offer.consumerPrice, offer.currency)}
              <span className="text-slate-400"> · </span>
              <span className="capitalize">{offer.status}</span>
            </span>
          </span>
          <IconChevron className="h-5 w-5 shrink-0 text-slate-500" open={isOpen} />
        </button>
        {!isEditing ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStartEdit();
            }}
            className="flex w-12 shrink-0 items-center justify-center text-slate-700 transition hover:bg-slate-50"
            aria-label={`Edit offer for ${offer.productName}`}
          >
            <IconPencil className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      {isOpen ? (
        <div className="border-t border-slate-100 px-4 pb-4 pt-4">
          {isEditing ? (
            <>
              <OfferFieldsForm
                draft={draft}
                plants={plants}
                onChange={setDraft}
              />
              {saveError ? <p className="mt-3 text-sm text-red-700">{saveError}</p> : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={isSaving}
                  className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50"
                >
                  {isSaving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  disabled={isSaving}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <OfferDetailView offer={offer} />
          )}
        </div>
      ) : null}
    </article>
  );
}

export function AdminOffersManager() {
  const [offers, setOffers] = useState<OfferWithProduct[]>([]);
  const [plants, setPlants] = useState<PlantProduct[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createDraft, setCreateDraft] = useState(emptyDraft);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredOffers = useMemo(
    () => offers.filter((offer) => offerMatchesSearch(offer, searchQuery)),
    [offers, searchQuery],
  );

  const loadData = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [offersRes, plantsRes] = await Promise.all([
        fetch("/api/offers", { cache: "no-store", signal }),
        fetch("/api/plants", { cache: "no-store", signal }),
      ]);
      const offersData = (await offersRes.json().catch(() => ({}))) as OffersApiResponse;
      const plantsData = (await plantsRes.json().catch(() => ({}))) as PlantsApiResponse;
      if (signal?.aborted) return;
      if (!offersRes.ok) {
        setLoadError(offersData.error ?? "Could not load offers");
        setOffers([]);
        return;
      }
      setOffers(offersData.offers ?? []);
      if (plantsRes.ok) {
        setPlants(plantsData.plants ?? []);
      }
    } catch {
      if (signal?.aborted) return;
      setLoadError("Network error while loading offers");
      setOffers([]);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  async function handleCreate() {
    if (!createDraft.productId.trim()) {
      setCreateError("Select a plant for this offer.");
      return;
    }
    const consumerPrice = Number(createDraft.consumerPrice);
    if (!Number.isFinite(consumerPrice) || consumerPrice < 0) {
      setCreateError("Consumer price must be a non-negative number.");
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    const payload = draftToPayload(createDraft);
    if (payload.supplierPrice === null) delete payload.supplierPrice;
    if (payload.supplierName === null) delete payload.supplierName;

    try {
      const res = await fetch("/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as OffersApiResponse;
      if (!res.ok) {
        setCreateError(data.error ?? "Could not create offer");
        return;
      }
      setShowCreate(false);
      setCreateDraft(emptyDraft());
      await loadData();
    } catch {
      setCreateError("Network error. Try again.");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
            Urban Plant · Admin
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-emerald-950">Offers</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin"
            className="text-sm font-medium text-emerald-700 underline underline-offset-2"
          >
            Admin
          </Link>
          <button
            type="button"
            onClick={() => {
              setShowCreate((open) => !open);
              setCreateError(null);
              if (showCreate) setCreateDraft(emptyDraft());
            }}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-700 text-white shadow-sm transition hover:bg-emerald-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
            aria-expanded={showCreate}
            aria-label={showCreate ? "Close create offer form" : "Create offer"}
          >
            <IconPlus className="h-6 w-6" />
          </button>
        </div>
      </div>

      <p className="mb-6 text-sm leading-relaxed text-slate-600">
        Sale offers linked to catalog plants. Images and currency come from the selected plant;
        each offer sets its own consumer price and optional supplier details.
      </p>

      {showCreate ? (
        <section className="mb-6 rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
          <h2 className="mb-4 text-base font-semibold text-emerald-950">New offer</h2>
          {plants.length === 0 ? (
            <p className="text-sm text-amber-800">
              Add plants to the catalog before creating offers.
            </p>
          ) : (
            <>
              <OfferFieldsForm
                draft={createDraft}
                plants={plants}
                onChange={setCreateDraft}
              />
              {createError ? <p className="mt-3 text-sm text-red-700">{createError}</p> : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={isCreating || plants.length === 0}
                  className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50"
                >
                  {isCreating ? "Creating…" : "Create offer"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreate(false);
                    setCreateDraft(emptyDraft());
                    setCreateError(null);
                  }}
                  disabled={isCreating}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {!isLoading && !loadError && offers.length > 0 ? (
        <label className="mb-4 block">
          <span className="sr-only">Search offers</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by plant, status…"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
          />
        </label>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-slate-600">Loading offers…</p>
      ) : loadError ? (
        <p className="text-sm text-red-700">{loadError}</p>
      ) : offers.length === 0 ? (
        <p className="rounded-2xl bg-white p-5 text-sm text-slate-600">No offers yet.</p>
      ) : filteredOffers.length === 0 ? (
        <p className="rounded-2xl bg-white p-5 text-sm text-slate-600">
          No offers match &ldquo;{searchQuery.trim()}&rdquo;.
        </p>
      ) : (
        <ul className="space-y-3">
          {filteredOffers.map((offer) => (
            <li key={offer.id}>
              <AdminOfferCard
                offer={offer}
                plants={plants}
                isEditing={editingId === offer.id}
                onStartEdit={() => {
                  setEditingId(offer.id);
                  setShowCreate(false);
                }}
                onCancelEdit={() => setEditingId(null)}
                onSaved={(updated) => {
                  setOffers((prev) =>
                    prev.map((item) => (item.id === updated.id ? updated : item)),
                  );
                  setEditingId(null);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
