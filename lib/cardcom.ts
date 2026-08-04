/**
 * Server-side Cardcom configuration and LowProfile clients (API v11).
 *
 * Import only from Route Handlers, Server Components, or other server code.
 * Never expose credentials to the client (no NEXT_PUBLIC_*, no API responses, no logs).
 *
 * Docs / Swagger:
 * - LowProfile/Create — POST https://secure.cardcom.solutions/api/v11/LowProfile/Create
 * - LowProfile/GetLpResult — POST https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult
 *   (Swagger method is POST JSON; article text saying GET is overridden by Swagger.)
 * ApiPassword is documented for refunds/cancellations (AdvancedDefinition), not Create/GetLpResult.
 */

/** Production terminal — never use for controlled Cardcom tests. */
export const CARDCOM_PRODUCTION_TERMINAL_NUMBER = 194476;

/** Official Cardcom test terminal. */
export const CARDCOM_TEST_TERMINAL_NUMBER = 1000;

/**
 * @deprecated Prefer CARDCOM_PRODUCTION_TERMINAL_NUMBER or getCardcomRuntimeConfig().
 * Kept as the production terminal constant used by existing offline payload checks.
 */
export const CARDCOM_TERMINAL_NUMBER = CARDCOM_PRODUCTION_TERMINAL_NUMBER;

/** Which Cardcom credential set / terminal to use. Never chosen by the browser. */
export type CardcomEnvironment = "production" | "test";

export type CardcomRuntimeConfig = {
  environment: CardcomEnvironment;
  terminalNumber: number;
  apiName: string;
};

const CARDCOM_LOW_PROFILE_CREATE_URL =
  "https://secure.cardcom.solutions/api/v11/LowProfile/Create";

/** Documented ChargeOnly operation (one-time charge). */
export const CARDCOM_OPERATION_CHARGE_ONLY = "ChargeOnly" as const;

/** Documented Hebrew language code for the payment page. */
export const CARDCOM_LANGUAGE_HE = "he" as const;

/** Documented ILS currency id (1 = shekel). */
export const CARDCOM_ISO_COIN_ID_ILS = 1 as const;

const CARDCOM_CREATE_TIMEOUT_MS = 20_000;
const CARDCOM_RETURN_VALUE_MAX_LENGTH = 250;
const CARDCOM_PRODUCT_NAME_MAX_LENGTH = 50;
const CARDCOM_CARD_OWNER_NAME_MAX_LENGTH = 100;
const CARDCOM_CARD_OWNER_PHONE_MAX_LENGTH = 20;
const CARDCOM_CARD_OWNER_EMAIL_MAX_LENGTH = 100;

export type CardcomConfig = {
  apiName: string;
  apiPassword: string;
};

/** Fields for Cardcom operations that require ApiPassword (e.g. refunds). Not used by Create. */
export type CardcomAuthFields = {
  ApiName: string;
  ApiPassword: string;
};

export function isCardcomEnvironment(value: unknown): value is CardcomEnvironment {
  return value === "production" || value === "test";
}

/**
 * Resolve terminal + ApiName for Create / GetLpResult.
 * Callers never supply TerminalNumber or ApiName directly.
 */
export function getCardcomRuntimeConfig(
  environment: CardcomEnvironment = "production",
): CardcomRuntimeConfig {
  if (environment === "test") {
    const apiName = process.env.CARDCOM_TEST_API_NAME?.trim();
    if (!apiName) {
      throw new CardcomError(
        "Cardcom test is not configured. Missing: CARDCOM_TEST_API_NAME. Add it to .env.local (see .env.example).",
        "config",
      );
    }
    return {
      environment: "test",
      terminalNumber: CARDCOM_TEST_TERMINAL_NUMBER,
      apiName,
    };
  }

  const apiName = process.env.CARDCOM_API_NAME?.trim();
  if (!apiName) {
    throw new CardcomError(
      "Cardcom is not configured. Missing: CARDCOM_API_NAME. Add it to .env.local (see .env.example) or Netlify Environment Variables.",
      "config",
    );
  }
  return {
    environment: "production",
    terminalNumber: CARDCOM_PRODUCTION_TERMINAL_NUMBER,
    apiName,
  };
}

/** Business input for LowProfile/Create. Callers never supply TerminalNumber / ApiName / ApiPassword. */
export type CreateCardcomLowProfileInput = {
  amount: number;
  returnValue: string;
  productName: string;
  successRedirectUrl: string;
  failedRedirectUrl: string;
  webHookUrl: string;
  cardOwnerName?: string;
  cardOwnerPhone?: string;
  cardOwnerEmail?: string;
};

/** Documented Create request body (API v11 JSON field names). */
export type CardcomLowProfileCreateRequest = {
  TerminalNumber: number;
  ApiName: string;
  Operation: typeof CARDCOM_OPERATION_CHARGE_ONLY;
  ReturnValue: string;
  Amount: number;
  SuccessRedirectUrl: string;
  FailedRedirectUrl: string;
  WebHookUrl: string;
  ProductName: string;
  Language: typeof CARDCOM_LANGUAGE_HE;
  ISOCoinId: typeof CARDCOM_ISO_COIN_ID_ILS;
  UIDefinition?: {
    CardOwnerNameValue?: string;
    CardOwnerPhoneValue?: string;
    CardOwnerEmailValue?: string;
  };
};

/** Documented Create response fields we handle. */
export type CardcomLowProfileCreateResponse = {
  ResponseCode: number;
  Description: string;
  LowProfileId: string;
  Url: string;
  UrlToPayPal?: string;
  UrlToBit?: string;
};

export class CardcomError extends Error {
  readonly code: "config" | "validation" | "network" | "http" | "parse" | "cardcom";
  readonly responseCode?: number;

  constructor(
    message: string,
    code: CardcomError["code"],
    options?: { responseCode?: number; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "CardcomError";
    this.code = code;
    if (options?.responseCode !== undefined) {
      this.responseCode = options.responseCode;
    }
  }
}

/**
 * Load and validate Cardcom credentials from the environment.
 * Throws a clear server error if either variable is missing.
 */
export function getCardcomConfig(): CardcomConfig {
  const apiName = process.env.CARDCOM_API_NAME?.trim();
  const apiPassword = process.env.CARDCOM_API_PASSWORD?.trim();

  if (!apiName || !apiPassword) {
    const missing = [
      !apiName ? "CARDCOM_API_NAME" : null,
      !apiPassword ? "CARDCOM_API_PASSWORD" : null,
    ].filter(Boolean);
    throw new CardcomError(
      `Cardcom is not configured. Missing: ${missing.join(", ")}. Add them to .env.local (see .env.example) or Netlify Environment Variables.`,
      "config",
    );
  }

  return { apiName, apiPassword };
}

/**
 * Auth fragment for operations that require ApiPassword (refunds / cancellations).
 * Do not use for LowProfile/Create.
 */
export function getCardcomAuthFields(): CardcomAuthFields {
  const { apiName, apiPassword } = getCardcomConfig();
  return {
    ApiName: apiName,
    ApiPassword: apiPassword,
  };
}

function normalizeOptionalText(
  value: string | undefined,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) {
    throw new CardcomError(
      `Cardcom ${field} must be at most ${maxLength} characters.`,
      "validation",
    );
  }
  return trimmed;
}

function assertHttpsPublicUrl(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new CardcomError(`Cardcom ${field} is required.`, "validation");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new CardcomError(`Cardcom ${field} must be a valid absolute URL.`, "validation");
  }

  if (url.protocol !== "https:") {
    throw new CardcomError(`Cardcom ${field} must be an HTTPS URL.`, "validation");
  }

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) {
    throw new CardcomError(
      `Cardcom ${field} must be a public HTTPS URL (not localhost).`,
      "validation",
    );
  }

  return trimmed;
}

/** Validate amount: positive, finite, at most 2 decimal places (Cardcom docs). */
export function normalizeCardcomAmount(amount: number): number {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new CardcomError("Cardcom amount must be a positive finite number.", "validation");
  }

  const scaled = amount * 100;
  const cents = Math.round(scaled);
  if (Math.abs(scaled - cents) > 1e-8) {
    throw new CardcomError(
      "Cardcom amount must have at most 2 decimal places.",
      "validation",
    );
  }

  return cents / 100;
}

/**
 * Validate business input and build the documented Create JSON body.
 * ApiName and TerminalNumber come from getCardcomRuntimeConfig — never from callers.
 * Exported for offline payload checks without calling Cardcom.
 */
export function buildCardcomLowProfileCreateRequest(
  apiName: string,
  input: CreateCardcomLowProfileInput,
  terminalNumber: number = CARDCOM_PRODUCTION_TERMINAL_NUMBER,
): CardcomLowProfileCreateRequest {
  const name = apiName.trim();
  if (!name) {
    throw new CardcomError("Cardcom ApiName is missing.", "config");
  }

  if (
    terminalNumber !== CARDCOM_PRODUCTION_TERMINAL_NUMBER &&
    terminalNumber !== CARDCOM_TEST_TERMINAL_NUMBER
  ) {
    throw new CardcomError("Cardcom TerminalNumber is not allowed.", "config");
  }

  const amount = normalizeCardcomAmount(input.amount);

  const returnValue = input.returnValue.trim();
  if (!returnValue) {
    throw new CardcomError("Cardcom returnValue is required.", "validation");
  }
  if (returnValue.length > CARDCOM_RETURN_VALUE_MAX_LENGTH) {
    throw new CardcomError(
      `Cardcom returnValue must be at most ${CARDCOM_RETURN_VALUE_MAX_LENGTH} characters.`,
      "validation",
    );
  }

  const productName = input.productName.trim();
  if (!productName) {
    throw new CardcomError("Cardcom productName is required.", "validation");
  }
  if (productName.length > CARDCOM_PRODUCT_NAME_MAX_LENGTH) {
    throw new CardcomError(
      `Cardcom productName must be at most ${CARDCOM_PRODUCT_NAME_MAX_LENGTH} characters.`,
      "validation",
    );
  }

  const successRedirectUrl = assertHttpsPublicUrl(
    input.successRedirectUrl,
    "successRedirectUrl",
  );
  const failedRedirectUrl = assertHttpsPublicUrl(
    input.failedRedirectUrl,
    "failedRedirectUrl",
  );
  const webHookUrl = assertHttpsPublicUrl(input.webHookUrl, "webHookUrl");

  const cardOwnerName = normalizeOptionalText(
    input.cardOwnerName,
    "cardOwnerName",
    CARDCOM_CARD_OWNER_NAME_MAX_LENGTH,
  );
  const cardOwnerPhone = normalizeOptionalText(
    input.cardOwnerPhone,
    "cardOwnerPhone",
    CARDCOM_CARD_OWNER_PHONE_MAX_LENGTH,
  );
  const cardOwnerEmail = normalizeOptionalText(
    input.cardOwnerEmail,
    "cardOwnerEmail",
    CARDCOM_CARD_OWNER_EMAIL_MAX_LENGTH,
  );

  const body: CardcomLowProfileCreateRequest = {
    TerminalNumber: terminalNumber,
    ApiName: name,
    Operation: CARDCOM_OPERATION_CHARGE_ONLY,
    ReturnValue: returnValue,
    Amount: amount,
    SuccessRedirectUrl: successRedirectUrl,
    FailedRedirectUrl: failedRedirectUrl,
    WebHookUrl: webHookUrl,
    ProductName: productName,
    Language: CARDCOM_LANGUAGE_HE,
    ISOCoinId: CARDCOM_ISO_COIN_ID_ILS,
  };

  if (cardOwnerName || cardOwnerPhone || cardOwnerEmail) {
    body.UIDefinition = {
      ...(cardOwnerName ? { CardOwnerNameValue: cardOwnerName } : {}),
      ...(cardOwnerPhone ? { CardOwnerPhoneValue: cardOwnerPhone } : {}),
      ...(cardOwnerEmail ? { CardOwnerEmailValue: cardOwnerEmail } : {}),
    };
  }

  return body;
}

function parseCreateResponse(data: unknown): CardcomLowProfileCreateResponse {
  if (!data || typeof data !== "object") {
    throw new CardcomError("Cardcom returned a malformed response.", "parse");
  }

  const record = data as Record<string, unknown>;
  const responseCodeRaw = record.ResponseCode;
  const responseCode =
    typeof responseCodeRaw === "number"
      ? responseCodeRaw
      : typeof responseCodeRaw === "string" && responseCodeRaw.trim() !== ""
        ? Number(responseCodeRaw)
        : NaN;

  if (!Number.isFinite(responseCode)) {
    throw new CardcomError("Cardcom response is missing ResponseCode.", "parse");
  }

  const description =
    typeof record.Description === "string" ? record.Description.trim() : "";

  if (responseCode !== 0) {
    // Keep the thrown message sanitized (ResponseCode only; no raw Cardcom body).
    throw new CardcomError(
      `Cardcom LowProfile/Create failed (ResponseCode ${responseCode}).`,
      "cardcom",
      { responseCode },
    );
  }

  const lowProfileId =
    typeof record.LowProfileId === "string" ? record.LowProfileId.trim() : "";
  const url = typeof record.Url === "string" ? record.Url.trim() : "";

  if (!lowProfileId || !url) {
    throw new CardcomError(
      "Cardcom Create succeeded but LowProfileId or Url is missing.",
      "parse",
      { responseCode },
    );
  }

  const result: CardcomLowProfileCreateResponse = {
    ResponseCode: responseCode,
    Description: description || "OK",
    LowProfileId: lowProfileId,
    Url: url,
  };

  if (typeof record.UrlToPayPal === "string" && record.UrlToPayPal.trim()) {
    result.UrlToPayPal = record.UrlToPayPal.trim();
  }
  if (typeof record.UrlToBit === "string" && record.UrlToBit.trim()) {
    result.UrlToBit = record.UrlToBit.trim();
  }

  return result;
}

/**
 * Create a Cardcom Low Profile payment page (API v11).
 * Does not finalize Urban Plant orders — callers own checkout wiring.
 * Pass `environment: "test"` only from the protected admin test path.
 */
export async function createCardcomLowProfile(
  input: CreateCardcomLowProfileInput,
  options?: { environment?: CardcomEnvironment },
): Promise<CardcomLowProfileCreateResponse> {
  const runtime = getCardcomRuntimeConfig(options?.environment ?? "production");
  const body = buildCardcomLowProfileCreateRequest(
    runtime.apiName,
    input,
    runtime.terminalNumber,
  );

  let response: Response;
  try {
    response = await fetch(CARDCOM_LOW_PROFILE_CREATE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CARDCOM_CREATE_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new CardcomError("Cardcom LowProfile/Create timed out.", "network", {
        cause: error,
      });
    }
    throw new CardcomError("Cardcom LowProfile/Create network error.", "network", {
      cause: error,
    });
  }

  const rawText = await response.text();
  let parsed: unknown;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch (error) {
    throw new CardcomError(
      response.ok
        ? "Cardcom returned a non-JSON response."
        : `Cardcom HTTP ${response.status} with a non-JSON body.`,
      "parse",
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new CardcomError(
      `Cardcom LowProfile/Create HTTP ${response.status}.`,
      "http",
    );
  }

  return parseCreateResponse(parsed);
}

const CARDCOM_LOW_PROFILE_GET_RESULT_URL =
  "https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult";

const CARDCOM_GET_RESULT_TIMEOUT_MS = 20_000;

/** Documented GetLpResult request (Swagger: POST JSON, no ApiPassword). */
export type GetCardcomLowProfileResultInput = {
  lowProfileId: string;
};

/** Nested charge details from LowProfileResult.TranzactionInfo (Swagger spelling). */
export type CardcomTransactionInfo = {
  responseCode: number;
  amount: number;
  coinId: number;
  transactionId?: number;
  description?: string;
};

/**
 * Normalized GetLpResult success payload.
 * Field spellings follow Cardcom Swagger (TranzactionInfo / TranzactionId).
 */
export type CardcomLowProfileResult = {
  responseCode: number;
  description: string;
  lowProfileId: string;
  returnValue: string;
  operation?: string;
  transactionId?: number;
  transaction: CardcomTransactionInfo;
};

/** Decimal-safe money equality (øre/agorot via integer cents). */
export function cardcomAmountsEqual(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.round(a * 100) === Math.round(b * 100);
}

function parseResponseCode(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseTransactionInfo(raw: unknown): CardcomTransactionInfo {
  if (!raw || typeof raw !== "object") {
    throw new CardcomError(
      "Cardcom GetLpResult is missing TranzactionInfo.",
      "parse",
    );
  }
  const record = raw as Record<string, unknown>;
  const responseCode = parseResponseCode(record.ResponseCode);
  if (responseCode === null) {
    throw new CardcomError(
      "Cardcom TranzactionInfo is missing ResponseCode.",
      "parse",
    );
  }

  const amountRaw = record.Amount;
  const amount =
    typeof amountRaw === "number"
      ? amountRaw
      : typeof amountRaw === "string" && amountRaw.trim() !== ""
        ? Number(amountRaw)
        : NaN;
  if (!Number.isFinite(amount)) {
    throw new CardcomError("Cardcom TranzactionInfo is missing Amount.", "parse");
  }

  const coinId = parseResponseCode(record.CoinId);
  if (coinId === null) {
    throw new CardcomError("Cardcom TranzactionInfo is missing CoinId.", "parse");
  }

  const result: CardcomTransactionInfo = {
    responseCode,
    amount,
    coinId,
  };

  const txId = record.TranzactionId;
  if (typeof txId === "number" && Number.isFinite(txId)) {
    result.transactionId = txId;
  }
  if (typeof record.Description === "string" && record.Description.trim()) {
    result.description = record.Description.trim();
  }

  return result;
}

/**
 * Parse GetLpResult JSON into a typed result.
 * Requires top-level ResponseCode === 0 and a successful ChargeOnly transaction.
 * Exported for offline verification without network.
 */
export function parseCardcomLowProfileResult(
  data: unknown,
): CardcomLowProfileResult {
  if (!data || typeof data !== "object") {
    throw new CardcomError("Cardcom GetLpResult returned a malformed response.", "parse");
  }

  const record = data as Record<string, unknown>;
  const responseCode = parseResponseCode(record.ResponseCode);
  if (responseCode === null) {
    throw new CardcomError("Cardcom GetLpResult is missing ResponseCode.", "parse");
  }

  const description =
    typeof record.Description === "string" ? record.Description.trim() : "";

  if (responseCode !== 0) {
    throw new CardcomError(
      `Cardcom GetLpResult failed (ResponseCode ${responseCode}).`,
      "cardcom",
      { responseCode },
    );
  }

  const lowProfileId =
    typeof record.LowProfileId === "string" ? record.LowProfileId.trim() : "";
  if (!lowProfileId) {
    throw new CardcomError(
      "Cardcom GetLpResult is missing LowProfileId.",
      "parse",
      { responseCode },
    );
  }

  const returnValue =
    typeof record.ReturnValue === "string" ? record.ReturnValue.trim() : "";
  if (!returnValue) {
    throw new CardcomError(
      "Cardcom GetLpResult is missing ReturnValue.",
      "parse",
      { responseCode },
    );
  }

  const transaction = parseTransactionInfo(record.TranzactionInfo);
  // ChargeOnly success: nested ResponseCode must be 0 (Swagger: 700/701 only for J2/J5).
  if (transaction.responseCode !== 0) {
    throw new CardcomError(
      `Cardcom charge was not successful (TranzactionInfo.ResponseCode ${transaction.responseCode}).`,
      "cardcom",
      { responseCode: transaction.responseCode },
    );
  }

  const result: CardcomLowProfileResult = {
    responseCode,
    description: description || "OK",
    lowProfileId,
    returnValue,
    transaction,
  };

  if (typeof record.Operation === "string" && record.Operation.trim()) {
    result.operation = record.Operation.trim();
  }
  const topTxId = record.TranzactionId;
  if (typeof topTxId === "number" && Number.isFinite(topTxId)) {
    result.transactionId = topTxId;
  }

  return result;
}

/**
 * Verify a Low Profile deal via Cardcom API v11 GetLpResult.
 *
 * Method: POST JSON (official Swagger /api/v11/LowProfile/GetLpResult).
 * Auth: TerminalNumber + ApiName only — ApiPassword is not in the Swagger schema.
 * Use the same `environment` that created the LowProfile (test vs production).
 */
export async function getCardcomLowProfileResult(
  input: GetCardcomLowProfileResultInput,
  options?: { environment?: CardcomEnvironment },
): Promise<CardcomLowProfileResult> {
  const lowProfileId = input.lowProfileId.trim();
  if (!lowProfileId) {
    throw new CardcomError("Cardcom LowProfileId is required.", "validation");
  }

  const runtime = getCardcomRuntimeConfig(options?.environment ?? "production");
  const body = {
    TerminalNumber: runtime.terminalNumber,
    ApiName: runtime.apiName,
    LowProfileId: lowProfileId,
  };

  let response: Response;
  try {
    response = await fetch(CARDCOM_LOW_PROFILE_GET_RESULT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CARDCOM_GET_RESULT_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new CardcomError("Cardcom GetLpResult timed out.", "network", {
        cause: error,
      });
    }
    throw new CardcomError("Cardcom GetLpResult network error.", "network", {
      cause: error,
    });
  }

  const rawText = await response.text();
  let parsed: unknown;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch (error) {
    throw new CardcomError(
      response.ok
        ? "Cardcom GetLpResult returned a non-JSON response."
        : `Cardcom GetLpResult HTTP ${response.status} with a non-JSON body.`,
      "parse",
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new CardcomError(
      `Cardcom GetLpResult HTTP ${response.status}.`,
      "http",
    );
  }

  return parseCardcomLowProfileResult(parsed);
}
