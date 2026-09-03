/**
 * Offline checks for Cardcom LowProfile/Create payload building.
 * Does NOT call Cardcom or charge anything.
 *
 * Run: npx tsx scripts/verify-cardcom-low-profile.ts
 */

import assert from "node:assert/strict";

import {
  CARDCOM_ISO_COIN_ID_ILS,
  CARDCOM_LANGUAGE_HE,
  CARDCOM_OPERATION_CHARGE_ONLY,
  CARDCOM_TERMINAL_NUMBER,
  CardcomError,
  buildCardcomLowProfileCreateRequest,
  normalizeCardcomAmount,
} from "../lib/cardcom";

function expectValidationError(fn: () => void, messageIncludes?: string): void {
  try {
    fn();
    assert.fail("expected CardcomError");
  } catch (error) {
    assert.ok(error instanceof CardcomError);
    assert.equal(error.code, "validation");
    if (messageIncludes) {
      assert.match(error.message, new RegExp(messageIncludes, "i"));
    }
  }
}

const validInput = {
  amount: 89.5,
  returnValue: "11111111-1111-1111-1111-111111111111",
  productName: "Monstera",
  successRedirectUrl: "https://example.com/payment/success",
  failedRedirectUrl: "https://example.com/payment/failed",
  webHookUrl: "https://example.com/api/payments/cardcom/webhook",
  cardOwnerName: "Test Customer",
  cardOwnerPhone: "0546605603",
  cardOwnerEmail: "test@example.com",
};

assert.equal(normalizeCardcomAmount(89.5), 89.5);
assert.equal(normalizeCardcomAmount(100), 100);
expectValidationError(() => normalizeCardcomAmount(0), "positive");
expectValidationError(() => normalizeCardcomAmount(-1), "positive");
expectValidationError(() => normalizeCardcomAmount(1.234), "2 decimal");

const body = buildCardcomLowProfileCreateRequest("test-api-name", validInput);

assert.deepEqual(body, {
  TerminalNumber: CARDCOM_TERMINAL_NUMBER,
  ApiName: "test-api-name",
  Operation: CARDCOM_OPERATION_CHARGE_ONLY,
  ReturnValue: validInput.returnValue,
  Amount: 89.5,
  SuccessRedirectUrl: validInput.successRedirectUrl,
  FailedRedirectUrl: validInput.failedRedirectUrl,
  WebHookUrl: validInput.webHookUrl,
  ProductName: "Monstera",
  Language: CARDCOM_LANGUAGE_HE,
  ISOCoinId: CARDCOM_ISO_COIN_ID_ILS,
  UIDefinition: {
    CardOwnerNameValue: "Test Customer",
    CardOwnerPhoneValue: "0546605603",
    CardOwnerEmailValue: "test@example.com",
  },
});

assert.equal(CARDCOM_TERMINAL_NUMBER, 194476);
assert.equal(CARDCOM_OPERATION_CHARGE_ONLY, "ChargeOnly");
assert.equal(CARDCOM_LANGUAGE_HE, "he");
assert.equal(CARDCOM_ISO_COIN_ID_ILS, 1);

// ApiPassword must never appear on the Create body.
assert.ok(!("ApiPassword" in body));
assert.ok(!("ApiPassword" in (body.UIDefinition ?? {})));
assert.ok(!JSON.stringify(body).includes("ApiPassword"));

expectValidationError(
  () =>
    buildCardcomLowProfileCreateRequest("test-api-name", {
      ...validInput,
      successRedirectUrl: "http://example.com/payment/success",
    }),
  "HTTPS",
);

expectValidationError(
  () =>
    buildCardcomLowProfileCreateRequest("test-api-name", {
      ...validInput,
      webHookUrl: "https://localhost/api/webhook",
    }),
  "localhost",
);

expectValidationError(
  () =>
    buildCardcomLowProfileCreateRequest("test-api-name", {
      ...validInput,
      productName: "x".repeat(51),
    }),
  "50",
);

expectValidationError(
  () =>
    buildCardcomLowProfileCreateRequest("test-api-name", {
      ...validInput,
      returnValue: "",
    }),
  "returnValue",
);

const withoutOwner = buildCardcomLowProfileCreateRequest("test-api-name", {
  amount: 10,
  returnValue: "order-1",
  productName: "Plant",
  successRedirectUrl: "https://example.com/payment/success",
  failedRedirectUrl: "https://example.com/payment/failed",
  webHookUrl: "https://example.com/api/payments/cardcom/webhook",
});
assert.equal(withoutOwner.UIDefinition, undefined);

const emptyOwner = buildCardcomLowProfileCreateRequest("test-api-name", {
  amount: 10,
  returnValue: "order-1",
  productName: "פרחים",
  successRedirectUrl: "https://example.com/payment/success",
  failedRedirectUrl: "https://example.com/payment/failed",
  webHookUrl: "https://example.com/api/payments/cardcom/webhook",
  cardOwnerName: "",
  cardOwnerPhone: "",
  cardOwnerEmail: "",
});
assert.equal(emptyOwner.UIDefinition, undefined);

console.log("verify-cardcom-low-profile: ok (no Cardcom network call)");
