/**
 * Development-only structured logging for the checkout → order pipeline.
 */

const DIVIDER = "========================";

function isOrderFlowDebugEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}

export function logOrderFlowSection(label: string, data: unknown): void {
  if (!isOrderFlowDebugEnabled()) return;
  console.group(`[${label}]`);
  console.log(JSON.parse(JSON.stringify(data)));
  console.groupEnd();
}

export function logOrderFlowStart(meta?: Record<string, unknown>): void {
  if (!isOrderFlowDebugEnabled()) return;
  console.log(`\n${DIVIDER}\nORDER FLOW START\n${DIVIDER}`);
  if (meta) logOrderFlowSection("REQUEST META", meta);
}

export function logOrderFlowEnd(): void {
  if (!isOrderFlowDebugEnabled()) return;
  console.log(`\n${DIVIDER}\nORDER FLOW END\n${DIVIDER}\n`);
}

export function logOrderFlowSkip(reason: string): void {
  if (!isOrderFlowDebugEnabled()) return;
  console.log(`[ORDER FLOW] skipped: ${reason}`);
}
