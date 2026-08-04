"use client";

import { useEffect, useState } from "react";

import { routes } from "@/lib/routes";

type AvailableSpot = {
  id: string;
  spotSlug: string;
  posName: string;
  status: string;
  currentOfferId: string;
};

type PreviewResult = {
  ok: true;
  preview: true;
  environment: string;
  terminalNumber: number;
  posSpotId: string;
  spotSlug: string;
  plantId: string;
  plantName: string;
  amount: number;
  fulfillmentMethod: string;
  warning: string;
};

type CreateResult = {
  ok: true;
  environment: string;
  terminalNumber: number;
  orderId: string;
  lowProfileId: string;
  paymentUrl: string;
  amount: number;
  plantId: string;
  posSpotId: string;
  spotSlug: string;
  fulfillmentMethod: string;
  nextSteps: string[];
};

export default function AdminCardcomTestPage() {
  const [spots, setSpots] = useState<AvailableSpot[]>([]);
  const [spotSlug, setSpotSlug] = useState("");
  const [fulfillmentMethod, setFulfillmentMethod] = useState<"delivery" | "pickup">(
    "delivery",
  );
  const [fullName, setFullName] = useState("Cardcom Test");
  const [customerEmail, setCustomerEmail] = useState("cardcom-test@example.com");
  const [phone, setPhone] = useState("0546605603");
  const [confirmHold, setConfirmHold] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [created, setCreated] = useState<CreateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(routes.api.posSpots());
        const data = (await res.json()) as { posSpots?: AvailableSpot[] };
        const available = (data.posSpots ?? []).filter((s) => s.status === "available");
        setSpots(available);
        if (available[0] && !spotSlug) setSpotSlug(available[0].spotSlug);
      } catch {
        setError("Could not load POS spots.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once
  }, []);

  async function runPreview() {
    setBusy(true);
    setError(null);
    setPreview(null);
    setCreated(null);
    try {
      const res = await fetch(routes.api.adminCardcomTest(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previewOnly: true,
          spotSlug,
          fulfillmentMethod,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Preview failed");
        return;
      }
      setPreview(data as PreviewResult);
    } catch {
      setError("Network error during preview.");
    } finally {
      setBusy(false);
    }
  }

  async function runCreate() {
    if (!confirmHold) {
      setError("Check the confirmation box before starting the real Cardcom test Create.");
      return;
    }
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const res = await fetch(routes.api.adminCardcomTest(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmHold: true,
          spotSlug,
          fulfillmentMethod,
          fullName,
          customerEmail,
          phone,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Create failed");
        return;
      }
      setCreated(data as CreateResult);
      setConfirmHold(false);
    } catch {
      setError("Network error during create.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg px-4 py-6 pb-24">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">
        Controlled test · Terminal 1000
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-emerald-950">Cardcom test payment</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        Admin-only. Uses <code className="text-xs">CARDCOM_TEST_API_NAME</code> and terminal{" "}
        <strong>1000</strong>. Production terminal 194476 is never used here. CheckoutForm is not
        connected.
      </p>

      <div className="mt-6 space-y-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-950">
        <p>
          Before Create: preview the POS, plant, amount, and hold warning. Only then confirm and
          start.
        </p>
        <p>Requires <code className="text-xs">APP_ORIGIN</code> (public HTTPS) and test ApiName.</p>
      </div>

      <label className="mt-6 block text-sm font-medium text-slate-700">
        Available POS spot
        <select
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2"
          value={spotSlug}
          onChange={(e) => {
            setSpotSlug(e.target.value);
            setPreview(null);
            setCreated(null);
          }}
        >
          {spots.length === 0 ? <option value="">No available spots</option> : null}
          {spots.map((s) => (
            <option key={s.id} value={s.spotSlug}>
              {s.spotSlug} — {s.posName}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-slate-700">Fulfillment</legend>
        <div className="mt-2 flex gap-3">
          <button
            type="button"
            className={`rounded-xl px-3 py-2 text-sm ${
              fulfillmentMethod === "delivery" ? "bg-emerald-800 text-white" : "bg-slate-100"
            }`}
            onClick={() => setFulfillmentMethod("delivery")}
          >
            Delivery → sold
          </button>
          <button
            type="button"
            className={`rounded-xl px-3 py-2 text-sm ${
              fulfillmentMethod === "pickup" ? "bg-emerald-800 text-white" : "bg-slate-100"
            }`}
            onClick={() => setFulfillmentMethod("pickup")}
          >
            Pickup → picked_up
          </button>
        </div>
      </fieldset>

      <div className="mt-4 grid gap-3">
        <label className="text-sm font-medium text-slate-700">
          Full name
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Email
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Phone
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !spotSlug}
          onClick={() => void runPreview()}
          className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Preview (no Cardcom call)
        </button>
      </div>

      {preview ? (
        <div className="mt-4 space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          <p>
            <span className="font-medium">POS:</span> {preview.spotSlug} ({preview.posSpotId})
          </p>
          <p>
            <span className="font-medium">Plant:</span> {preview.plantName}
          </p>
          <p>
            <span className="font-medium">Amount:</span> ₪{preview.amount}
          </p>
          <p>
            <span className="font-medium">Fulfillment:</span> {preview.fulfillmentMethod}
          </p>
          <p>
            <span className="font-medium">Terminal:</span> {preview.terminalNumber} (test)
          </p>
          <p className="text-amber-800">{preview.warning}</p>
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmHold}
              onChange={(e) => setConfirmHold(e.target.checked)}
              className="mt-1"
            />
            <span>
              I understand this POS will move to <strong>held_for_payment</strong> and Cardcom test
              Create will run.
            </span>
          </label>
          <button
            type="button"
            disabled={busy || !confirmHold}
            onClick={() => void runCreate()}
            className="mt-3 rounded-xl bg-amber-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Start Cardcom test Create
          </button>
        </div>
      ) : null}

      {created ? (
        <div className="mt-4 space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-sm">
          <p className="font-semibold text-emerald-950">Test LowProfile created</p>
          <p>
            <span className="font-medium">orderId:</span>{" "}
            <code className="text-xs">{created.orderId}</code>
          </p>
          <p>
            <span className="font-medium">lowProfileId:</span>{" "}
            <code className="text-xs">{created.lowProfileId}</code>
          </p>
          <p>
            <a
              href={created.paymentUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-emerald-800 underline"
            >
              Open Cardcom test payment page
            </a>
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-slate-700">
            {created.nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
    </main>
  );
}
