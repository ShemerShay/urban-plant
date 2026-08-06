# Cardcom document + Urban Plant confirmation email

Audit summary (no implementation yet).  
Goal: after a **verified** Cardcom payment, create the accounting document, fetch its PDF, and send the **existing** Urban Plant confirmation email with the PDF attached. Document/email failure must **not** undo payment or POS finalization.

---

## Intended flow

```
verified GetLpResult
  → Documents/CreateDocument (linked to transaction)
  → fetch PDF
  → send existing Urban Plant email + PDF attachment
```

Payment/POS stay committed even if document or email fails.

---

## 1. Deal number mapping

**Use** `GetLpResult.TranzactionInfo.TranzactionId` as:

```json
"DealNumbers": [{ "DealNumber": <TranzactionId> }]
```

| Source | Evidence |
| --- | --- |
| CreateDocument docs | `DealNumber` = internal deal number of the completed transaction |
| Swagger | `TranzactionId` and `DealNumber` are both `int64` |
| Legacy Name-to-Value | `DealNumber` = `InternalDealNumber` |

Confirm once against sandbox before production. Persist `cardcom_transaction_id` on the order at finalize time (not stored today).

---

## 2. CreateDocument request (post-payment)

**Endpoint:** `POST https://secure.cardcom.solutions/api/v11/Documents/CreateDocument`

Requires Cardcom **Documents** module. Auth uses `ApiName` + `ApiPassword` (same env as refunds; match `order.cardcomEnv`).

```json
{
  "ApiName": "<CARDCOM_API_NAME>",
  "ApiPassword": "<CARDCOM_API_PASSWORD>",
  "DealNumbers": [{ "DealNumber": 209413394 }],
  "Document": {
    "DocumentTypeToCreate": "Auto",
    "IsSendByEmail": false,
    "Name": "<order.fullName>",
    "Email": "<order.customerEmail>",
    "Phone": "<order.phone>",
    "AddressLine1": "<delivery address if any>",
    "Products": [
      {
        "Description": "<plant/product name>",
        "Quantity": 1,
        "UnitCost": 89.5
      }
    ],
    "ExternalId": "<orderId>"
  }
}
```

### Important field notes

| Field | Note |
| --- | --- |
| `DocumentTypeToCreate: "Auto"` | Uses terminal settings 3→4; do **not** hardcode a legal document type in code |
| `IsSendByEmail: false` | **Required.** Swagger default is `true`; otherwise Cardcom may email the customer |
| `Name` | Required |
| `Products[].Description` + `UnitCost` | Required; `Quantity` defaults to 1 |

### Response (`DocumentInfo`)

- `ResponseCode` (0 = success)
- `DocumentType` — **resolved** type (store this; needed later)
- `DocumentNumber`
- `DocumentUrl` — optional / nullable

---

## 3. PDF download

Do **not** rely only on `DocumentUrl`:

- CreateDocument may return `DocumentUrl` (nullable)
- GetLpResult docs mark `DocumentUrl` as **“Currently not working”** / often `null`

### Official fallback

`POST https://secure.cardcom.solutions/api/v11/Documents/CreateDocumentUrl`

```json
{
  "ApiName": "...",
  "ApiPassword": "...",
  "DocumentType": "TaxInvoiceAndReceipt",
  "DocumentNumber": 593032
}
```

→ `DocUrl`

**Critical:** CreateDocumentUrl **rejects `"Auto"`**. Always pass the **resolved** `DocumentType` from CreateDocument.

Then fetch the URL server-side and verify PDF bytes / `Content-Type` before attaching.

---

## 4. Urban Plant email

Existing copy lives in `app/api/send-purchase-email/route.ts` (`buildEmailHtml` + subject `Your Urban Plant order is confirmed`).

| Question | Answer |
| --- | --- |
| Can we keep current copy? | **Yes** |
| Attachments today? | **No** — nodemailer call has no `attachments` |
| Nodemailer support? | **Yes** — add `attachments: [{ filename, content, contentType: "application/pdf" }]` |

Prefer a shared server helper called after webhook finalize (not an HTTP self-call to the route).

Cardcom webhook today does **not** send email. Set `IsSendByEmail: false` so the customer gets **only** the Urban Plant email.

---

## 5. Minimum database fields

| Column | Purpose |
| --- | --- |
| `cardcom_transaction_id` | `TranzactionId` → CreateDocument `DealNumber` |
| `cardcom_document_type` | Resolved type from CreateDocument (not `"Auto"`) |
| `cardcom_document_number` | Document number |
| `purchase_email_sent_at` | Idempotent “already sent” |
| `purchase_email_last_error` | Retry / error state (nullable) |

Optional later: `purchase_email_status` enum.

---

## 6. Implementation plan (when coding)

1. **Migration** — add fields above; save `cardcom_transaction_id` at successful finalize.
2. **Post-finalize side effect (non-blocking)** after payment/POS commit:
   - if no document number → `CreateDocument` (`Auto`, `IsSendByEmail: false`, customer/product from order)
   - persist type + number
   - fetch PDF (`DocumentUrl` if usable → else `CreateDocumentUrl`)
   - send Urban Plant email + PDF
   - set `purchase_email_sent_at` or `purchase_email_last_error`
   - **never** roll back sold / picked_up / POS on failure
3. **Idempotency** — skip CreateDocument if type+number exist; skip email if `purchase_email_sent_at` set (safe on webhook retries).
4. **Email** — reuse existing HTML/subject; add attachment only.
5. **Hydration fix** (`CustomerRecoveryActions`) — resolve sessionStorage return path in `useEffect` so SSR/client match on `/payment/success`.

### Out of scope for smallest path

- Creating the document inside LowProfile/Create
- Trusting browser payment status
- Undoing payment on document/email failure
- Assuming a fixed document type (e.g. TaxInvoiceAndReceipt) in CreateDocument

---

## 7. Current codebase gaps (today)

| Area | Status |
| --- | --- |
| LowProfile/Create | ChargeOnly only — no `Document` object |
| GetLpResult | Parses charge fields; does not persist `TranzactionId` / `DocumentInfo` on order |
| Webhook | Finalizes payment/POS; no email, no CreateDocument |
| Orders schema | Has `cardcom_env`, customer email; no document/email columns yet |
| `send-purchase-email` | Copy exists; unused by Cardcom flow; no PDF attachment |

---

## Sources

- Cardcom Swagger v11: `/api/v11/Documents/CreateDocument`, `/api/v11/Documents/CreateDocumentUrl`
- [Create a document associated to a deal](https://cardcomapi.zendesk.com/hc/he/articles/25532880302738)
- [Create document URL](https://cardcomapi.zendesk.com/hc/he/articles/25565747889682)
- [LowProfile Create / GetLpResult](https://cardcomapi.zendesk.com/hc/he/articles/28448202810514)
