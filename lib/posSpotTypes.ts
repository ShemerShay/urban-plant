export type PosSpotStatus = "available" | "sold" | "inactive" | "held_for_payment";

const POS_SPOT_STATUS_SET = new Set<PosSpotStatus>([
  "available",
  "sold",
  "inactive",
  "held_for_payment",
]);

export function isPosSpotStatus(value: unknown): value is PosSpotStatus {
  return typeof value === "string" && POS_SPOT_STATUS_SET.has(value as PosSpotStatus);
}

export function parsePosSpotStatus(value: unknown): PosSpotStatus | null {
  return isPosSpotStatus(value) ? value : null;
}

export interface PosSpot {
  /** UUID primary key — internal relations only; never shown in admin UI. */
  id: string;
  /** Readable internal identifier: partner_spotnumber_pocket (normalized). */
  spotName: string;
  partnerLocationId: string;
  posNumber?: string;
  /** FK to pockets.id — preferred pocket relationship. Nullable = Unassigned. */
  pocketId?: string;
  /** @deprecated Legacy enum value; kept for migration safety. Prefer pocketId. */
  pocket?: string;
  /** @deprecated Custom label when legacy pocket was "other". Prefer pocketId. */
  pocketOther?: string;
  /** Human-readable label for orders and display; derived from partner + number + pocket. */
  posName: string;
  /** Optional notes; never used for slug generation. */
  spotDescription?: string;
  placementNotes?: string;
  /** Public URL segment for /pos/{spotSlug} and QR codes. */
  spotSlug: string;
  currentOfferId: string;
  status: PosSpotStatus;
  /** When the current offer was placed on this POS (timestamptz). */
  offerPlacedAt?: string;
  /** true = checked within the current due window; false = needs check or overdue (see nextCheck). */
  checkStatus: boolean;
  /** Who performed the last check; empty when unchecked or overdue (display normalization). */
  checkBy?: string;
  /** Next due check date (YYYY-MM-DD); only advances when the spot is checked again. */
  nextCheck?: string;
  /** Optional weekly note for field staff. */
  posWeeklyNote?: string;
  createdAt: string;
  /** When status became held_for_payment (for abandoned-hold expiry). */
  paymentHoldStartedAt?: string;
  /**
   * payment_attempts.id that owns this hold (Option B).
   * Set on acquire; cleared on release / finalize / expiry.
   */
  paymentHoldAttemptId?: string;
}
