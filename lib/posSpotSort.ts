import type { PosSpot } from "./posSpotTypes";

/** Sort POS spots by numeric spot number ascending (1, 2, … 9, 10), not lexicographic. */
export function comparePosSpotsByPosNumberAsc(a: PosSpot, b: PosSpot): number {
  const aNum = Number.parseInt(a.posNumber ?? "", 10);
  const bNum = Number.parseInt(b.posNumber ?? "", 10);
  const aOk = Number.isFinite(aNum);
  const bOk = Number.isFinite(bNum);
  if (aOk && bOk && aNum !== bNum) return aNum - bNum;
  if (aOk && !bOk) return -1;
  if (!aOk && bOk) return 1;
  const byLabel = (a.posNumber ?? "").localeCompare(b.posNumber ?? "", undefined, {
    numeric: true,
  });
  if (byLabel !== 0) return byLabel;
  return a.spotName.localeCompare(b.spotName);
}

export function sortPosSpotsByPosNumberAsc(spots: PosSpot[]): PosSpot[] {
  return [...spots].sort(comparePosSpotsByPosNumberAsc);
}
