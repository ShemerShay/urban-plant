/**
 * Verification: POS checkout email opt-in + plant post-payment without customer email.
 * Cardcom Create / GetLpResult / Documents and Gmail are mocked. No real network, no charge.
 *
 * Run: npx tsx scripts/verify-email-opt-in.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TEL_AVIV_STREETS } from "../constants/telAvivStreets";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_PUBLIC_ORIGIN = "https://urban-plant-email-opt-in-verify.example.com";

async function main(): Promise<void> {
  await import("./stub-server-only.mjs");
  const { loadEnvLocal } = await import("./load-env-local.mjs");
  await loadEnvLocal();

  const {
    canSubmitCheckout,
    getCheckoutCustomerFieldRequirements,
    getCheckoutCustomerServerError,
    getCheckoutFieldErrors,
  } = await import("../lib/checkoutValidation");
  const { buildCreateDocumentRequest } = await import("../lib/cardcomDocuments");
  const { parseCardcomLowProfileResult } = await import("../lib/cardcom");

  // ---------------------------------------------------------------- pure checks
  const empty = {
    fullName: "",
    email: "",
    phone: "",
    deliveryStreet: "",
    deliveryHouseNumber: "",
    apartmentOrNotes: "",
  };
  const delivery = {
    ...empty,
    fullName: "Ada Lovelace",
    phone: "0546605603",
    deliveryStreet: "Rothschild",
    deliveryHouseNumber: "1",
  };
  const keys = (e: object) => Object.keys(e).sort();

  // 1. Delivery without opt-in: address + name + phone required, email not.
  assert.deepEqual(keys(getCheckoutFieldErrors(empty, "delivery", { emailOptIn: false })), [
    "deliveryHouseNumber",
    "deliveryStreet",
    "fullName",
    "phone",
  ]);
  assert.deepEqual(keys(getCheckoutFieldErrors(delivery, "delivery", { emailOptIn: false })), []);
  assert.equal(canSubmitCheckout(delivery, "delivery", { emailOptIn: false }), true);

  // 2. Delivery with opt-in also requires a valid email.
  assert.deepEqual(keys(getCheckoutFieldErrors(delivery, "delivery", { emailOptIn: true })), ["email"]);
  assert.equal(
    getCheckoutFieldErrors({ ...delivery, email: "nope" }, "delivery", { emailOptIn: true }).email,
    "validation.email",
  );
  assert.deepEqual(
    keys(getCheckoutFieldErrors({ ...delivery, email: "a@b.co" }, "delivery", { emailOptIn: true })),
    [],
  );

  // 3. Pickup without opt-in: nothing required.
  assert.deepEqual(keys(getCheckoutFieldErrors(empty, "pickup", { emailOptIn: false })), []);
  assert.equal(canSubmitCheckout(empty, "pickup", { emailOptIn: false }), true);

  // 4. Pickup with opt-in: email only (no name/phone).
  assert.deepEqual(keys(getCheckoutFieldErrors(empty, "pickup", { emailOptIn: true })), ["email"]);
  assert.deepEqual(
    keys(getCheckoutFieldErrors({ ...empty, email: "a@b.co" }, "pickup", { emailOptIn: true })),
    [],
  );
  assert.deepEqual(getCheckoutCustomerFieldRequirements("pickup", { emailOptIn: true }), {
    fullName: false,
    email: true,
    phone: false,
  });
  assert.deepEqual(getCheckoutCustomerFieldRequirements("pickup", { emailOptIn: false }), {
    fullName: false,
    email: false,
    phone: false,
  });
  assert.deepEqual(getCheckoutCustomerFieldRequirements("delivery", { emailOptIn: false }), {
    fullName: true,
    email: false,
    phone: true,
  });

  // 5. Old callers (no rules) keep legacy behavior: name, email, phone always required.
  for (const method of ["delivery", "pickup"] as const) {
    const legacy = keys(getCheckoutFieldErrors(empty, method));
    assert.deepEqual(
      legacy,
      method === "delivery"
        ? ["deliveryHouseNumber", "deliveryStreet", "email", "fullName", "phone"]
        : ["email", "fullName", "phone"],
    );
    assert.deepEqual(getCheckoutCustomerFieldRequirements(method), {
      fullName: true,
      email: true,
      phone: true,
    });
  }
  assert.equal(
    getCheckoutCustomerServerError({
      fulfillmentMethod: "pickup",
      fullName: "",
      email: "",
      phone: "",
    }),
    "fullName is required",
  );
  assert.equal(
    getCheckoutCustomerServerError({
      fulfillmentMethod: "pickup",
      fullName: "A",
      email: "",
      phone: "0546605603",
    }),
    "customerEmail is required and must be a valid email",
  );
  assert.equal(
    getCheckoutCustomerServerError({
      fulfillmentMethod: "delivery",
      fullName: "A",
      email: "a@b.co",
      phone: "1",
    }),
    "Please enter a valid 10-digit Israeli phone number.",
  );

  // Server helper matrix (opt-in rules).
  const srv = (o: {
    f: "delivery" | "pickup";
    optIn: boolean;
    name?: string;
    email?: string;
    phone?: string;
  }) =>
    getCheckoutCustomerServerError({
      fulfillmentMethod: o.f,
      emailOptIn: o.optIn,
      fullName: o.name ?? "",
      email: o.email ?? "",
      phone: o.phone ?? "",
    });
  assert.equal(srv({ f: "delivery", optIn: false, name: "A", phone: "0546605603" }), null);
  assert.equal(srv({ f: "delivery", optIn: false, phone: "0546605603" }), "fullName is required");
  assert.equal(
    srv({ f: "delivery", optIn: false, name: "A" }),
    "Please enter a valid 10-digit Israeli phone number.",
  );
  assert.equal(
    srv({ f: "delivery", optIn: true, name: "A", phone: "0546605603" }),
    "customerEmail is required and must be a valid email",
  );
  assert.equal(
    srv({ f: "delivery", optIn: true, name: "A", phone: "0546605603", email: "a@b.co" }),
    null,
  );
  assert.equal(srv({ f: "pickup", optIn: false }), null);
  assert.equal(
    srv({ f: "pickup", optIn: true }),
    "customerEmail is required and must be a valid email",
  );
  assert.equal(srv({ f: "pickup", optIn: true, email: "a@b.co" }), null);

  // Cardcom document request: Email omitted when absent, present when provided.
  {
    const base = {
      dealNumber: 1,
      name: "Customer",
      phone: "",
      productDescription: "Plant",
      unitCost: 10,
      externalId: randomUUID(),
    };
    const auth = { ApiName: "n", ApiPassword: "p" };
    const noEmail = buildCreateDocumentRequest(base, auth).Document as Record<string, unknown>;
    assert.equal("Email" in noEmail, false);
    assert.equal(noEmail.IsSendByEmail, false);
    const noEmailBlank = buildCreateDocumentRequest({ ...base, email: "  " }, auth)
      .Document as Record<string, unknown>;
    assert.equal("Email" in noEmailBlank, false);
    const withEmail = buildCreateDocumentRequest({ ...base, email: "a@b.co" }, auth)
      .Document as Record<string, unknown>;
    assert.equal(withEmail.Email, "a@b.co");
  }

  // Callers of the shared validators: POS CheckoutForm and Catalog shop checkout.
  // No admin manual-order caller exists on this branch (removed in 6c85777).
  {
    const { readdirSync, statSync } = await import("node:fs");
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(name)) {
          const src = readFileSync(full, "utf8");
          if (/getCheckoutFieldErrors\(|canSubmitCheckout\(/.test(src)) {
            callers.push(path.relative(root, full).replace(/\\/g, "/"));
          }
        }
      }
    };
    for (const dir of ["app", "components", "lib"]) walk(path.join(root, dir));
    assert.deepEqual(callers.sort(), [
      "components/checkout/CheckoutForm.tsx",
      "components/shop/ShopCheckout.tsx",
      "lib/checkoutValidation.ts",
    ]);
  }

  // Flower form path stays legacy: opt-in only applies to non-flowers.
  {
    const formSource = readFileSync(
      path.join(root, "components", "checkout", "CheckoutForm.tsx"),
      "utf8",
    );
    assert.ok(formSource.includes('const usesEmailOptIn = inventoryType !== "flowers";'));
  }

  console.log("verify-email-opt-in: pure checks ok");

  // ---------------------------------------------------------------- DB checks
  const { getOfferById } = await import("../lib/offerStorage");
  const { appendOrder, getOrderById } = await import("../lib/ordersStorage");
  const { deletePaymentAttemptById, getPaymentAttemptById } = await import(
    "../lib/paymentAttemptStorage"
  );
  const {
    getPosSpotById,
    readPosSpots,
    releasePosSpotHoldForPayment,
    setPosSpotStatus,
  } = await import("../lib/posSpotStorage");
  const { processCardcomWebhook } = await import("../lib/processCardcomWebhook");
  const { processOrderDocumentAndEmail } = await import("../lib/processOrderDocumentAndEmail");
  const { startCardcomPaymentPrep } = await import("../lib/startCardcomPaymentPrep");
  const { sql } = await import("../lib/db");

  const spots = await readPosSpots();
  const available = spots.find((s) => s.status === "available");
  if (!available) {
    console.log("verify-email-opt-in: skip DB (no available POS spot)");
    return;
  }
  const offer = await getOfferById(available.currentOfferId ?? "");
  if (!offer || offer.status !== "active" || offer.consumerPrice <= 0) {
    console.log("verify-email-opt-in: skip DB (no valid offer)");
    return;
  }

  const beforeStatus = available.status;
  const street = TEL_AVIV_STREETS[0] ?? "Rothschild";
  const createdAttemptIds: string[] = [];
  const createdOrderIds: string[] = [];
  const pdfBytes = Buffer.from("%PDF-1.4 mock urban plant document");

  async function releaseOwnedHold(): Promise<void> {
    const spot = await getPosSpotById(available!.id);
    if (spot?.status === "held_for_payment" && spot.paymentHoldAttemptId) {
      await releasePosSpotHoldForPayment(available!.id, spot.paymentHoldAttemptId);
    }
  }

  type PrepFields = {
    f: "delivery" | "pickup";
    emailOptIn?: boolean;
    fullName?: string;
    email?: string;
    phone?: string;
  };

  async function prep(fields: PrepFields, lowProfileId: string) {
    await releaseOwnedHold();
    await setPosSpotStatus(available!.id, "available");
    const result = await startCardcomPaymentPrep(
      {
        plantId: offer!.productId,
        spotSlug: available!.spotSlug,
        fullName: fields.fullName ?? "",
        customerEmail: fields.email ?? "",
        phone: fields.phone ?? "",
        fulfillmentMethod: fields.f,
        ...(typeof fields.emailOptIn === "boolean" ? { emailOptIn: fields.emailOptIn } : {}),
        ...(fields.f === "delivery"
          ? { deliveryStreet: street, deliveryHouseNumber: "1", apartmentOrNotes: "" }
          : {}),
      },
      {
        publicOrigin: TEST_PUBLIC_ORIGIN,
        createLowProfile: async () => ({
          ResponseCode: 0,
          Description: "OK",
          LowProfileId: lowProfileId,
          Url: `https://secure.cardcom.solutions/Interface/LowProfile.aspx?LowProfileId=${lowProfileId}`,
        }),
      },
    );
    if (result.ok) createdAttemptIds.push(result.attemptId);
    return result;
  }

  function mockLp(result: {
    lowProfileId: string;
    returnValue: string;
    amount: number;
    transactionId: number;
  }) {
    return async (id: string) => {
      assert.equal(id, result.lowProfileId);
      return parseCardcomLowProfileResult({
        ResponseCode: 0,
        Description: "OK",
        LowProfileId: result.lowProfileId,
        ReturnValue: result.returnValue,
        TranzactionId: result.transactionId,
        TranzactionInfo: {
          ResponseCode: 0,
          Amount: result.amount,
          CoinId: 1,
          TranzactionId: result.transactionId,
        },
      });
    };
  }

  type Counters = { create: number; pdf: number; email: number; internal: number };
  function makeDeps(
    counters: Counters,
    opts: {
      documentNumber: number;
      expectEmail?: string;
      failDocument?: () => boolean;
      failInternal?: boolean;
      onCreateInput?: (input: { email?: string; name: string; phone: string }) => void;
    },
  ) {
    return {
      createDocument: async (input: {
        email?: string;
        name: string;
        phone: string;
      }) => {
        counters.create += 1;
        opts.onCreateInput?.(input);
        if (opts.failDocument?.()) throw new Error("Cardcom document unavailable");
        return { documentType: "TaxInvoiceAndReceipt", documentNumber: opts.documentNumber };
      },
      fetchPdf: async () => {
        counters.pdf += 1;
        return { bytes: pdfBytes, filename: `urban-plant-${opts.documentNumber}.pdf` };
      },
      sendEmail: async (params: {
        customerEmail: string;
        attachments?: Array<{ contentType?: string; content: Buffer; filename: string }>;
      }) => {
        counters.email += 1;
        assert.equal(params.customerEmail, opts.expectEmail);
        return { messageId: "mock-customer" };
      },
      sendInternalNotification: async (params: { customerEmail: string }) => {
        counters.internal += 1;
        if (opts.failInternal) throw new Error("internal SMTP failed");
        return { messageId: "mock-internal", customerEmail: params.customerEmail };
      },
    };
  }

  async function finalize(
    attemptId: string,
    lowProfileId: string,
    price: number,
    txId: number,
    deps: ReturnType<typeof makeDeps>,
  ) {
    const result = await processCardcomWebhook(
      { LowProfileId: lowProfileId },
      {
        getLpResult: mockLp({ lowProfileId, returnValue: attemptId, amount: price, transactionId: txId }),
        documentEmailDeps: deps as never,
      },
    );
    const attempt = await getPaymentAttemptById(attemptId);
    if (attempt?.finalizedOrderId) createdOrderIds.push(attempt.finalizedOrderId);
    return { result, attempt };
  }

  try {
    // Server prep: validation + storage rules.
    {
      // Delivery, opt-in unchecked: no email required; any submitted email is not stored.
      const lp = `lp-optin-d0-${randomUUID()}`;
      const r = await prep(
        { f: "delivery", emailOptIn: false, fullName: "Ada", phone: "0546605603", email: "leak@example.com" },
        lp,
      );
      assert.equal(r.ok, true);
      if (!r.ok) throw new Error("prep failed");
      const a = await getPaymentAttemptById(r.attemptId);
      assert.equal(a?.customerEmail, "");
      assert.equal(a?.fullName, "Ada");
      assert.equal(a?.phone, "0546605603");
      assert.ok(a?.address);
    }
    {
      // Delivery missing name / phone is still rejected.
      const noName = await prep({ f: "delivery", emailOptIn: false, phone: "0546605603" }, `lp-${randomUUID()}`);
      assert.equal(noName.ok, false);
      if (!noName.ok) assert.equal(noName.error, "fullName is required");
      const noPhone = await prep({ f: "delivery", emailOptIn: false, fullName: "Ada" }, `lp-${randomUUID()}`);
      assert.equal(noPhone.ok, false);
      if (!noPhone.ok) assert.match(noPhone.error, /10-digit/);
    }
    {
      // Delivery opt-in without email rejected; with email stored lowercased.
      const bad = await prep(
        { f: "delivery", emailOptIn: true, fullName: "Ada", phone: "0546605603" },
        `lp-${randomUUID()}`,
      );
      assert.equal(bad.ok, false);
      if (!bad.ok) assert.match(bad.error, /customerEmail is required/);
      const ok = await prep(
        { f: "delivery", emailOptIn: true, fullName: "Ada", phone: "0546605603", email: "Ada@Example.com" },
        `lp-optin-d1-${randomUUID()}`,
      );
      assert.equal(ok.ok, true);
      if (ok.ok) assert.equal((await getPaymentAttemptById(ok.attemptId))?.customerEmail, "ada@example.com");
    }
    {
      // Pickup opt-in unchecked: nothing required; nothing stored.
      const r = await prep({ f: "pickup", emailOptIn: false }, `lp-optin-p0-${randomUUID()}`);
      assert.equal(r.ok, true);
      if (r.ok) {
        const a = await getPaymentAttemptById(r.attemptId);
        assert.equal(a?.fullName, "");
        assert.equal(a?.phone, "");
        assert.equal(a?.customerEmail, "");
      }
    }
    {
      // Pickup opt-in checked: email only; name/phone ignored; missing email rejected.
      const bad = await prep({ f: "pickup", emailOptIn: true }, `lp-${randomUUID()}`);
      assert.equal(bad.ok, false);
      const ok = await prep(
        { f: "pickup", emailOptIn: true, email: "p@example.com", fullName: "Ignored", phone: "0546605603" },
        `lp-optin-p1-${randomUUID()}`,
      );
      assert.equal(ok.ok, true);
      if (ok.ok) {
        const a = await getPaymentAttemptById(ok.attemptId);
        assert.equal(a?.customerEmail, "p@example.com");
        assert.equal(a?.fullName, "");
        assert.equal(a?.phone, "");
      }
    }
    {
      // Old caller (no emailOptIn): legacy rules, pickup still needs name + email + phone.
      const legacyBad = await prep({ f: "pickup" }, `lp-${randomUUID()}`);
      assert.equal(legacyBad.ok, false);
      if (!legacyBad.ok) assert.equal(legacyBad.error, "fullName is required");
      const legacyNoEmail = await prep(
        { f: "delivery", fullName: "Ada", phone: "0546605603" },
        `lp-${randomUUID()}`,
      );
      assert.equal(legacyNoEmail.ok, false);
      if (!legacyNoEmail.ok) assert.match(legacyNoEmail.error, /customerEmail is required/);
      const legacyOk = await prep(
        { f: "pickup", fullName: "Ada", phone: "0546605603", email: "legacy@example.com" },
        `lp-optin-legacy-${randomUUID()}`,
      );
      assert.equal(legacyOk.ok, true);
      if (legacyOk.ok) {
        const a = await getPaymentAttemptById(legacyOk.attemptId);
        assert.equal(a?.customerEmail, "legacy@example.com");
        assert.equal(a?.fullName, "Ada");
      }
    }
    console.log("verify-email-opt-in: POS prep rules ok");

    // 6 + 7: plant order without email -> document, no customer email, internal notice, skipped.
    {
      const lp = `lp-noemail-${randomUUID()}`;
      const p = await prep({ f: "pickup", emailOptIn: false }, lp);
      assert.equal(p.ok, true);
      if (!p.ok) throw new Error("prep failed");
      const price = (await getPaymentAttemptById(p.attemptId))!.amount;
      const counters: Counters = { create: 0, pdf: 0, email: 0, internal: 0 };
      let seenEmail: string | undefined = "unset";
      let seenName = "";
      const deps = makeDeps(counters, {
        documentNumber: 810001,
        onCreateInput: (input) => {
          seenEmail = input.email;
          seenName = input.name;
        },
      });
      const { result, attempt } = await finalize(p.attemptId, lp, price, 710000001, deps);
      assert.equal(result.outcome, "finalized");
      assert.equal(result.httpStatus, 200);
      const order = await getOrderById(attempt!.finalizedOrderId!);
      assert.equal(order?.orderStatus, "picked_up");
      assert.equal(order?.purchaseEmailStatus, "skipped");
      assert.equal(order?.purchaseEmailSentAt, undefined);
      assert.equal(order?.cardcomDocumentNumber, 810001);
      assert.equal(order?.cardcomDocumentType, "TaxInvoiceAndReceipt");
      assert.equal(counters.create, 1);
      assert.equal(seenEmail, undefined);
      assert.equal(seenName, "Customer");
      assert.equal(counters.pdf, 0);
      assert.equal(counters.email, 0);
      assert.equal(counters.internal, 1);
      assert.equal((await getPosSpotById(available.id))?.status, "sold");

      // Duplicate webhook: no second document or notice.
      const dup = await processCardcomWebhook(
        { LowProfileId: lp },
        {
          getLpResult: mockLp({ lowProfileId: lp, returnValue: p.attemptId, amount: price, transactionId: 710000001 }),
          documentEmailDeps: deps as never,
        },
      );
      assert.equal(dup.outcome, "already_finalized");
      const direct = await processOrderDocumentAndEmail(order!.orderId, deps as never);
      assert.equal(direct.outcome, "skipped");
      assert.equal(counters.create, 1);
      assert.equal(counters.internal, 1);
      assert.equal((await getOrderById(order!.orderId))?.purchaseEmailStatus, "skipped");
      await setPosSpotStatus(available.id, "available");
    }

    // 8: plant order with email -> English customer email + PDF, internal sent separately.
    {
      const lp = `lp-withemail-${randomUUID()}`;
      const p = await prep({ f: "pickup", emailOptIn: true, email: "buyer@example.com" }, lp);
      assert.equal(p.ok, true);
      if (!p.ok) throw new Error("prep failed");
      const price = (await getPaymentAttemptById(p.attemptId))!.amount;
      const counters: Counters = { create: 0, pdf: 0, email: 0, internal: 0 };
      let attachment: { contentType?: string; filename: string; content: Buffer } | undefined;
      const deps = makeDeps(counters, { documentNumber: 810002, expectEmail: "buyer@example.com" });
      const baseSend = deps.sendEmail;
      deps.sendEmail = async (params) => {
        attachment = params.attachments?.[0];
        return baseSend(params);
      };
      const { result, attempt } = await finalize(p.attemptId, lp, price, 710000002, deps);
      assert.equal(result.outcome, "finalized");
      const order = await getOrderById(attempt!.finalizedOrderId!);
      assert.equal(order?.purchaseEmailStatus, "sent");
      assert.ok(order?.purchaseEmailSentAt);
      assert.equal(counters.create, 1);
      assert.equal(counters.pdf, 1);
      assert.equal(counters.email, 1);
      assert.equal(counters.internal, 1);
      assert.equal(attachment?.contentType, "application/pdf");
      assert.equal(attachment?.content.equals(pdfBytes), true);
      await setPosSpotStatus(available.id, "available");
    }

    // 10a: document failure on a no-email order never undoes payment; retry completes once.
    {
      const lp = `lp-noemail-docfail-${randomUUID()}`;
      const p = await prep({ f: "pickup", emailOptIn: false }, lp);
      assert.equal(p.ok, true);
      if (!p.ok) throw new Error("prep failed");
      const price = (await getPaymentAttemptById(p.attemptId))!.amount;
      const counters: Counters = { create: 0, pdf: 0, email: 0, internal: 0 };
      let failDoc = true;
      const deps = makeDeps(counters, { documentNumber: 810003, failDocument: () => failDoc });
      const { result, attempt } = await finalize(p.attemptId, lp, price, 710000003, deps);
      assert.equal(result.outcome, "finalized");
      assert.equal(result.httpStatus, 200);
      const failed = await getOrderById(attempt!.finalizedOrderId!);
      assert.equal(failed?.orderStatus, "picked_up");
      assert.equal(failed?.purchaseEmailStatus, "failed");
      assert.equal((await getPaymentAttemptById(p.attemptId))?.status, "finalized");
      assert.equal(counters.internal, 0);
      failDoc = false;
      const retry = await processOrderDocumentAndEmail(failed!.orderId, deps as never);
      assert.equal(retry.outcome, "skipped");
      const done = await getOrderById(failed!.orderId);
      assert.equal(done?.purchaseEmailStatus, "skipped");
      assert.equal(done?.cardcomDocumentNumber, 810003);
      assert.equal(counters.internal, 1);
      await setPosSpotStatus(available.id, "available");
    }

    // 10b: internal notification failure on a no-email order does not fail the order.
    {
      const lp = `lp-noemail-intfail-${randomUUID()}`;
      const p = await prep({ f: "pickup", emailOptIn: false }, lp);
      assert.equal(p.ok, true);
      if (!p.ok) throw new Error("prep failed");
      const price = (await getPaymentAttemptById(p.attemptId))!.amount;
      const counters: Counters = { create: 0, pdf: 0, email: 0, internal: 0 };
      const deps = makeDeps(counters, { documentNumber: 810004, failInternal: true });
      const { result, attempt } = await finalize(p.attemptId, lp, price, 710000004, deps);
      assert.equal(result.outcome, "finalized");
      const order = await getOrderById(attempt!.finalizedOrderId!);
      assert.equal(order?.orderStatus, "picked_up");
      assert.equal(order?.purchaseEmailStatus, "skipped");
      assert.equal(counters.internal, 1);
      await setPosSpotStatus(available.id, "available");
    }

    // 9: flowers unchanged: no email -> no document, no notice, status untouched.
    {
      const { createPlant, deletePlant, getPlantByIdAsync } = await import("../lib/plantStorage");
      const sample = await getPlantByIdAsync(offer.productId);
      assert.ok(sample, "need a catalog plant to clone a flower");
      const flowerId = randomUUID();
      await createPlant({
        ...sample,
        id: flowerId,
        name: "Verify Flower Opt-In",
        inventoryType: "flowers",
        catalogPublished: false,
        createdAt: new Date().toISOString(),
      });
      const orderId = randomUUID();
      try {
        await appendOrder({
          orderId,
          checkoutSessionId: `lp-flower-optin-${randomUUID()}`,
          cardcomEnv: "test",
          posSpotId: available.id,
          offerId: offer.id,
          plantId: flowerId,
          plantName: "Verify Flower Opt-In",
          locationId: available.partnerLocationId,
          locationName: "Verify Partner",
          locationAddress: null,
          price: offer.consumerPrice,
          fullName: "",
          customerEmail: "",
          phone: "",
          address: "",
          apartmentOrNotes: "",
          fulfillmentMethod: "pickup",
          createdAt: new Date().toISOString(),
          orderStatus: "picked_up",
          pickedUpAt: new Date().toISOString(),
          source: "online",
          snapshot: {
            productId: flowerId,
            productName: "Verify Flower Opt-In",
            offerId: offer.id,
            consumerPrice: offer.consumerPrice,
            posSpotId: available.id,
            spotSlug: available.spotSlug,
            fulfillmentType: "pickup",
          },
          cardcomTransactionId: 710000099,
        });
        createdOrderIds.push(orderId);
        const result = await processOrderDocumentAndEmail(orderId, {
          createDocument: async () => {
            throw new Error("must not create document for flower without email");
          },
          sendEmail: async () => {
            throw new Error("must not email flower without email");
          },
          sendInternalNotification: async () => {
            throw new Error("must not notify flower without email");
          },
        });
        assert.equal(result.outcome, "skipped");
        assert.equal(result.error, "flower_no_customer_email");
        const after = await getOrderById(orderId);
        assert.notEqual(after?.purchaseEmailStatus, "failed");
        assert.notEqual(after?.purchaseEmailStatus, "skipped");
      } finally {
        await deletePlant(flowerId);
      }
    }

    // Migration 042: 'skipped' accepted by the CHECK constraint.
    {
      const rows = (await sql`
        SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE conname = 'orders_purchase_email_status_check'
      `) as Array<{ def: string }>;
      assert.ok(rows[0]?.def.includes("'skipped'"));
    }

    console.log("verify-email-opt-in: post-payment checks ok");
    console.log("verify-email-opt-in: ok");
  } finally {
    await releaseOwnedHold();
    for (const id of [...new Set(createdAttemptIds)]) {
      await deletePaymentAttemptById(id);
    }
    for (const id of [...new Set(createdOrderIds)]) {
      await sql`DELETE FROM orders WHERE order_id = ${id}::uuid`;
    }
    await setPosSpotStatus(available.id, beforeStatus);
  }
}

void main().catch((error) => {
  console.error("verify-email-opt-in: FAILED", error);
  process.exitCode = 1;
});
