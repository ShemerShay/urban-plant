/** Keep the selected pot only when it still matches the current plant Variant. */
export function retainCompatiblePotId(
  selectedPotId: string | null,
  pots: { id: string }[],
): string | null {
  if (!selectedPotId) return null;
  return pots.some((pot) => pot.id === selectedPotId) ? selectedPotId : null;
}
