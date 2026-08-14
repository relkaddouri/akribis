"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Global search, living in the sidebar rather than the header — it sits
 * with navigation, which is what it is, and stops eating a third of the
 * header band on every screen.
 *
 * Collapsed, there is no room for a field: it becomes the magnifier alone,
 * and clicking it reopens the sidebar and puts the cursor in the input,
 * so the affordance still leads somewhere instead of doing nothing.
 */
export function GlobalSearch({
  collapsed,
  onExpand,
}: {
  collapsed: boolean;
  onExpand: () => void;
}) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const focusOnExpand = useRef(false);

  useEffect(() => {
    if (collapsed || !focusOnExpand.current) return;
    focusOnExpand.current = false;
    inputRef.current?.focus();
  }, [collapsed]);

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Rechercher"
            onClick={() => {
              focusOnExpand.current = true;
              onExpand();
            }}
            className={cn(
              "flex w-full items-center justify-center rounded-lg py-sp-sm text-muted-foreground",
              "transition-colors hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Search className="size-4" strokeWidth={1.75} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          Rechercher
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="flex items-center gap-sp-sm rounded-lg bg-muted/60 px-sp-sm py-sp-xs text-sm text-muted-foreground transition-colors focus-within:bg-muted">
      <Search className="size-4 shrink-0" strokeWidth={1.75} />
      <input
        ref={inputRef}
        type="text"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        // A single short hint: the sidebar is a quarter of the header's
        // width, so the rotating "Essayez ..." suggestions would have been
        // cut off mid-word rather than teaching anything.
        placeholder="Rechercher..."
        aria-label="Recherche globale"
        className="w-full min-w-0 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
      />
      <kbd className="shrink-0 rounded-md border border-border bg-card px-sp-xs py-sp-xs text-[10px] font-medium text-muted-foreground">
        ⌘K
      </kbd>
    </div>
  );
}
