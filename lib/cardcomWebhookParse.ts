/**
 * Cardcom LowProfile webhook JSON parser.
 *
 * Official Swagger v11 webhook contract:
 * - Method: POST
 * - Content-Type: application/json
 * - Request body schema: LowProfileResult
 *
 * Webhook values are NEVER treated as proof of payment.
 * Only LowProfileId is used — to call POST …/LowProfile/GetLpResult.
 */

/**
 * Official Swagger `LowProfileResult` shape (webhook body / GetLpResult response).
 * Spellings follow Cardcom (`TranzactionId`, `TranzactionInfo`).
 * All fields except the extracted LowProfileId are optional for parsing tolerance.
 */
export type CardcomLowProfileResultWebhookBody = {
  ResponseCode?: number;
  Description?: string | null;
  TerminalNumber?: number;
  LowProfileId?: string;
  TranzactionId?: number;
  ReturnValue?: string | null;
  Operation?: string | null;
  UIValues?: Record<string, unknown> | null;
  DocumentInfo?: Record<string, unknown> | null;
  TokenInfo?: Record<string, unknown> | null;
  SuspendedInfo?: Record<string, unknown> | null;
  TranzactionInfo?: {
    ResponseCode?: number;
    Description?: string | null;
    TranzactionId?: number;
    TerminalNumber?: number;
    Amount?: number;
    CoinId?: number;
    [key: string]: unknown;
  } | null;
  ExternalPaymentVector?: string | null;
  Country?: string | null;
  UTM?: Record<string, unknown> | null;
  IssuerAuthCodeDescription?: string | null;
  AccountId?: number | null;
};

export type ParsedCardcomWebhook = {
  /** Sole identifier used to trigger GetLpResult. */
  lowProfileId: string;
  /**
   * Optional fields observed on the webhook body for ops/tests.
   * Must never be used to finalize payment.
   */
  reported: {
    responseCode?: number;
    terminalNumber?: number;
    returnValue?: string;
    tranzactionId?: number;
    operation?: string;
    transactionResponseCode?: number;
    transactionAmount?: number;
    transactionCoinId?: number;
  };
};

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function asOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * Parse a Cardcom webhook JSON body as LowProfileResult.
 * Requires a non-empty `LowProfileId`. Other documented fields are optional.
 * Does not accept form-urlencoded bodies or undocumented field aliases
 * (e.g. camelCase `lowProfileId`).
 */
export function parseCardcomWebhookLowProfileResult(
  body: unknown,
): ParsedCardcomWebhook | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const record = body as Record<string, unknown>;
  const lowProfileId = asOptionalTrimmedString(record.LowProfileId);
  if (!lowProfileId) return null;

  const txRaw = record.TranzactionInfo;
  const tx =
    txRaw && typeof txRaw === "object" && !Array.isArray(txRaw)
      ? (txRaw as Record<string, unknown>)
      : null;

  const reported: ParsedCardcomWebhook["reported"] = {};

  const responseCode = asFiniteNumber(record.ResponseCode);
  if (responseCode !== undefined) reported.responseCode = responseCode;

  const terminalNumber = asFiniteNumber(record.TerminalNumber);
  if (terminalNumber !== undefined) reported.terminalNumber = terminalNumber;

  const returnValue = asOptionalTrimmedString(record.ReturnValue);
  if (returnValue !== undefined) reported.returnValue = returnValue;

  const tranzactionId = asFiniteNumber(record.TranzactionId);
  if (tranzactionId !== undefined) reported.tranzactionId = tranzactionId;

  const operation = asOptionalTrimmedString(record.Operation);
  if (operation !== undefined) reported.operation = operation;

  if (tx) {
    const txCode = asFiniteNumber(tx.ResponseCode);
    if (txCode !== undefined) reported.transactionResponseCode = txCode;
    const amount = asFiniteNumber(tx.Amount);
    if (amount !== undefined) reported.transactionAmount = amount;
    const coinId = asFiniteNumber(tx.CoinId);
    if (coinId !== undefined) reported.transactionCoinId = coinId;
  }

  return { lowProfileId, reported };
}

/** Alias: extract LowProfileId from a LowProfileResult webhook body. */
export function parseCardcomWebhookLowProfileId(
  body: unknown,
): ParsedCardcomWebhook | null {
  return parseCardcomWebhookLowProfileResult(body);
}
