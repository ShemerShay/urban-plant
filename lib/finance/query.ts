import type { FinanceActivityFilter } from "@/lib/finance/types";
import { routes } from "@/lib/routes";

export function financePageHref(input: {
  month: string;
  activity: FinanceActivityFilter;
}): string {
  const params = new URLSearchParams({
    month: input.month,
    activity: input.activity,
  });
  return `${routes.admin.finance()}?${params.toString()}`;
}
