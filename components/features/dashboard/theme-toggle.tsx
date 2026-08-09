"use client";

import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const [isDark, setIsDark] = useState(false);
  const label = isDark ? "Mode sombre" : "Mode clair";

  const button = (
    <button
      type="button"
      onClick={() => setIsDark((v) => !v)}
      aria-pressed={isDark}
      aria-label={collapsed ? label : undefined}
      className={cn(
        "flex w-full items-center gap-sp-sm rounded-lg py-sp-sm text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
        collapsed ? "justify-center px-0" : "px-sp-sm",
      )}
    >
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        <Sun
          className={cn("absolute size-4 transition-opacity", isDark ? "opacity-0" : "opacity-100")}
          strokeWidth={1.75}
        />
        <Moon
          className={cn("absolute size-4 transition-opacity", isDark ? "opacity-100" : "opacity-0")}
          strokeWidth={1.75}
        />
      </span>
      {!collapsed && (
        <>
          <span className="flex-1 text-left">{label}</span>
          <span className={cn("relative h-4 w-7 rounded-full transition-colors", isDark ? "bg-primary" : "bg-muted")}>
            <span
              className={cn(
                "absolute top-0.5 left-0.5 size-3 rounded-full bg-white shadow-soft transition-transform",
                isDark && "translate-x-3.5"
              )}
            />
          </span>
        </>
      )}
    </button>
  );

  if (!collapsed) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
    </Tooltip>
  );
}
