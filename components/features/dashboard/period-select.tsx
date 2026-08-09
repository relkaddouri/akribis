"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { PERIOD_LABELS, PERIODS, type Period } from "@/lib/dashboard/periods";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Drives the comparison window through the URL (`?periode=`) rather than
 * local state, so the figures stay computed on the server, the choice
 * survives a refresh, and a given view is shareable.
 */
export function PeriodSelect({ value }: { value: Period }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function handleChange(next: string) {
    const params = new URLSearchParams(searchParams);
    params.set("periode", next);
    startTransition(() => {
      // `scroll: false` so changing the window doesn't yank the reader
      // back to the top of the dashboard.
      router.push(`?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger size="sm" className="w-44" aria-label="Période de comparaison" data-pending={isPending}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERIODS.map((period) => (
          <SelectItem key={period} value={period}>
            {PERIOD_LABELS[period]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
