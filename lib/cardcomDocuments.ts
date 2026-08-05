/**
 * Cardcom Documents API (CreateDocument + CreateDocumentUrl + PDF fetch).
 * Server-only. Never expose ApiPassword.
 */

import "server-only";

import {
  CardcomError,
  getCardcomAuthFieldsForEnvironment,
  type CardcomEnvironment,
} from "@/lib/cardcom";

const CARDCOM_CREATE_DOCUMENT_URL =
  "https://secure.cardcom.solutions/api/v11/Documents/CreateDocument";
const CARDCOM_CREATE_DOCUMENT_URL_ENDPOINT =
  "https://secure.cardcom.solutions/api/v11/Documents/CreateDocumentUrl";

const CARDCOM_DOCUMENTS_TIMEOUT_MS = 30_000;
const CARDCOM_PDF_FETCH_TIMEOUT_MS = 30_000;

export type CreateCardcomDocumentInput = {
  dealNumber: number;
  name: string;
  email: string;
  phone: string;
  addressLine1?: string;
  productDescription: string;
  unitCost: number;
  externalId: string;
};

export type CardcomDocumentInfo = {
  documentType: string;
  documentNumber: number;
  documentUrl?: string;
};

export type CardcomPdfBytes = {
  bytes: Buffer;
  filename: string;
};

function parseResponseCode(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function postCardcomJson(
  url: string,
  body: Record<string, unknown>,
  label: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CARDCOM_DOCUMENTS_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new CardcomError(`Cardcom ${label} timed out.`, "network", {
        cause: error,
      });
    }
    throw new CardcomError(`Cardcom ${label} network error.`, "network", {
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
        ? `Cardcom ${label} returned a non-JSON response.`
        : `Cardcom ${label} HTTP ${response.status} with a non-JSON body.`,
      "parse",
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new CardcomError(`Cardcom ${label} HTTP ${response.status}.`, "http");
  }

  return parsed;
}

/**
 * Build CreateDocument request body. Always IsSendByEmail: false.
 * DocumentTypeToCreate is always "Auto" (resolved type comes from the response).
 */
export function buildCreateDocumentRequest(
  input: CreateCardcomDocumentInput,
  auth: { ApiName: string; ApiPassword: string },
): Record<string, unknown> {
  const document: Record<string, unknown> = {
    DocumentTypeToCreate: "Auto",
    IsSendByEmail: false,
    Name: input.name,
    Email: input.email,
    Phone: input.phone,
    Products: [
      {
        Description: input.productDescription,
        Quantity: 1,
        UnitCost: input.unitCost,
      },
    ],
    ExternalId: input.externalId,
  };

  const address = input.addressLine1?.trim();
  if (address) {
    document.AddressLine1 = address;
  }

  return {
    ApiName: auth.ApiName,
    ApiPassword: auth.ApiPassword,
    DealNumbers: [{ DealNumber: input.dealNumber }],
    Document: document,
  };
}

/**
 * Parse CreateDocument JSON. Rejects Auto as a stored document type.
 */
export function parseCreateDocumentResponse(data: unknown): CardcomDocumentInfo {
  if (!data || typeof data !== "object") {
    throw new CardcomError("Cardcom CreateDocument returned a malformed response.", "parse");
  }
  const record = data as Record<string, unknown>;
  const responseCode = parseResponseCode(record.ResponseCode);
  if (responseCode === null) {
    throw new CardcomError("Cardcom CreateDocument is missing ResponseCode.", "parse");
  }
  if (responseCode !== 0) {
    throw new CardcomError(
      `Cardcom CreateDocument failed (ResponseCode ${responseCode}).`,
      "cardcom",
      { responseCode },
    );
  }

  const documentType =
    typeof record.DocumentType === "string" ? record.DocumentType.trim() : "";
  if (!documentType) {
    throw new CardcomError("Cardcom CreateDocument is missing DocumentType.", "parse");
  }
  if (documentType.toLowerCase() === "auto") {
    throw new CardcomError(
      'Cardcom CreateDocument returned DocumentType "Auto"; resolved type is required.',
      "parse",
    );
  }

  const documentNumber = parseFiniteNumber(record.DocumentNumber);
  if (documentNumber === null) {
    throw new CardcomError("Cardcom CreateDocument is missing DocumentNumber.", "parse");
  }

  const info: CardcomDocumentInfo = {
    documentType,
    documentNumber,
  };

  if (typeof record.DocumentUrl === "string" && record.DocumentUrl.trim()) {
    info.documentUrl = record.DocumentUrl.trim();
  }

  return info;
}

/**
 * Build CreateDocumentUrl request. Never accepts DocumentType "Auto".
 */
export function buildCreateDocumentUrlRequest(
  input: { documentType: string; documentNumber: number },
  auth: { ApiName: string; ApiPassword: string },
): Record<string, unknown> {
  const documentType = input.documentType.trim();
  if (!documentType) {
    throw new CardcomError("DocumentType is required for CreateDocumentUrl.", "validation");
  }
  if (documentType.toLowerCase() === "auto") {
    throw new CardcomError(
      'CreateDocumentUrl must not receive DocumentType "Auto".',
      "validation",
    );
  }
  if (!Number.isFinite(input.documentNumber)) {
    throw new CardcomError("DocumentNumber is required for CreateDocumentUrl.", "validation");
  }

  return {
    ApiName: auth.ApiName,
    ApiPassword: auth.ApiPassword,
    DocumentType: documentType,
    DocumentNumber: input.documentNumber,
  };
}

export function parseCreateDocumentUrlResponse(data: unknown): string {
  if (!data || typeof data !== "object") {
    throw new CardcomError(
      "Cardcom CreateDocumentUrl returned a malformed response.",
      "parse",
    );
  }
  const record = data as Record<string, unknown>;
  const responseCode = parseResponseCode(record.ResponseCode);
  if (responseCode !== null && responseCode !== 0) {
    throw new CardcomError(
      `Cardcom CreateDocumentUrl failed (ResponseCode ${responseCode}).`,
      "cardcom",
      { responseCode },
    );
  }

  const docUrl =
    typeof record.DocUrl === "string"
      ? record.DocUrl.trim()
      : typeof record.DocumentUrl === "string"
        ? record.DocumentUrl.trim()
        : "";
  if (!docUrl) {
    throw new CardcomError("Cardcom CreateDocumentUrl is missing DocUrl.", "parse");
  }
  return docUrl;
}

/** True when bytes look like a PDF (%PDF magic). */
export function isPdfBuffer(bytes: Buffer): boolean {
  if (bytes.length < 5) return false;
  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

/**
 * Fetch a URL and return PDF bytes only when Content-Type and/or magic bytes confirm PDF.
 */
export async function fetchPdfFromUrl(url: string): Promise<Buffer> {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new CardcomError("PDF URL is empty.", "validation");
  }

  let response: Response;
  try {
    response = await fetch(trimmed, {
      method: "GET",
      signal: AbortSignal.timeout(CARDCOM_PDF_FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new CardcomError("Cardcom PDF download timed out.", "network", {
        cause: error,
      });
    }
    throw new CardcomError("Cardcom PDF download network error.", "network", {
      cause: error,
    });
  }

  if (!response.ok) {
    throw new CardcomError(
      `Cardcom PDF download HTTP ${response.status}.`,
      "http",
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const contentTypeLooksPdf = contentType.includes("application/pdf");

  if (!isPdfBuffer(bytes) && !contentTypeLooksPdf) {
    throw new CardcomError(
      "Downloaded document is not a valid PDF.",
      "parse",
    );
  }
  if (!isPdfBuffer(bytes)) {
    throw new CardcomError(
      "Downloaded document Content-Type claimed PDF but bytes are not PDF.",
      "parse",
    );
  }

  return bytes;
}

export async function createCardcomDocument(
  input: CreateCardcomDocumentInput,
  options?: { environment?: CardcomEnvironment },
): Promise<CardcomDocumentInfo> {
  const environment = options?.environment ?? "production";
  const auth = getCardcomAuthFieldsForEnvironment(environment);
  const body = buildCreateDocumentRequest(input, auth);
  const parsed = await postCardcomJson(
    CARDCOM_CREATE_DOCUMENT_URL,
    body,
    "CreateDocument",
  );
  return parseCreateDocumentResponse(parsed);
}

export async function createCardcomDocumentUrl(
  input: { documentType: string; documentNumber: number },
  options?: { environment?: CardcomEnvironment },
): Promise<string> {
  const environment = options?.environment ?? "production";
  const auth = getCardcomAuthFieldsForEnvironment(environment);
  const body = buildCreateDocumentUrlRequest(input, auth);
  const parsed = await postCardcomJson(
    CARDCOM_CREATE_DOCUMENT_URL_ENDPOINT,
    body,
    "CreateDocumentUrl",
  );
  return parseCreateDocumentUrlResponse(parsed);
}

/**
 * Prefer DocumentUrl when it yields a valid PDF; otherwise CreateDocumentUrl.
 * Never calls CreateDocumentUrl with "Auto".
 */
export async function fetchCardcomDocumentPdf(
  info: CardcomDocumentInfo,
  options?: { environment?: CardcomEnvironment },
): Promise<CardcomPdfBytes> {
  if (info.documentUrl) {
    try {
      const bytes = await fetchPdfFromUrl(info.documentUrl);
      return {
        bytes,
        filename: `urban-plant-${info.documentNumber}.pdf`,
      };
    } catch {
      // Fall through to CreateDocumentUrl.
    }
  }

  const url = await createCardcomDocumentUrl(
    {
      documentType: info.documentType,
      documentNumber: info.documentNumber,
    },
    options,
  );
  const bytes = await fetchPdfFromUrl(url);
  return {
    bytes,
    filename: `urban-plant-${info.documentNumber}.pdf`,
  };
}
