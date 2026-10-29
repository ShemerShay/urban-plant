/**
 * Variant Add/Edit pot options from Catalog Pots (GET /api/pots).
 * Active pots are choices even when central quantity is 0.
 * An inactive pot stays visible only while it is the saved choice.
 */

export type CatalogPotEditInput = {
  id: string;
  name: string;
  diameterCm?: number | null;
  active?: boolean;
  /** Central quantity is not a filter. Quantity 0 stays selectable. */
  quantity?: number | null;
};

export type CatalogPotEditChoice = {
  id: string;
  label: string;
  potId: string;
};

function formatDiameter(cm: number): string | null {
  if (!Number.isFinite(cm) || cm <= 0) return null;
  const rounded = Math.round(cm * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return `${text} cm`;
}

export function catalogPotChoiceLabel(pot: Pick<CatalogPotEditInput, "name" | "diameterCm">): string {
  const name = pot.name.trim();
  const diameter = pot.diameterCm == null ? null : formatDiameter(pot.diameterCm);
  return diameter ? `${name} · ${diameter}` : name;
}

export function catalogPotEditChoices(
  pots: CatalogPotEditInput[],
  options?: { includePotId?: string | null },
): CatalogPotEditChoice[] {
  const includePotId = options?.includePotId?.trim() || null;
  const choices: CatalogPotEditChoice[] = [];
  for (const pot of pots) {
    const potId = pot.id.trim();
    const name = pot.name.trim();
    if (!potId || !name) continue;
    const active = pot.active !== false;
    if (!active && potId !== includePotId) continue;
    // quantity is ignored: configuration does not reserve central stock.
    choices.push({
      id: potId,
      label: catalogPotChoiceLabel(pot),
      potId,
    });
  }
  return choices;
}
