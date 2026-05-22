export type PosSpotStatus = "available" | "sold" | "inactive";

export interface PosSpot {
  /** UUID primary key — internal relations only; never shown in admin UI. */
  id: string;
  /** Readable internal identifier: partner_spotnumber_pocket (normalized). */
  spotName: string;
  partnerLocationId: string;
  posNumber?: string;
  /** Normalized pocket value; optional on legacy rows migrated before pocket existed. */
  pocket?: string;
  /** Custom pocket label when pocket is "other". */
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
}
