"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SIDEBAR_COLLAPSED_COOKIE } from "@/components/features/dashboard/sidebar-cookie";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The sidebar shell and its item primitives, shared by the pharmacy
 * dashboard and the Akribis back-office.
 *
 * Extracted from dashboard-sidebar.tsx rather than copied: the card
 * treatment, the collapse behaviour and its cookie, the tooltip-when-
 * collapsed rule and the item states are the parts that must not drift
 * between the two spaces. What differs — the brand lockup, the menu
 * itself, the footer — comes in as props.
 */

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export const itemBaseClass =
  "flex items-center gap-sp-sm rounded-lg py-sp-sm text-sm font-medium transition-colors";

/** Wraps an item in a tooltip only while collapsed, when its label is hidden. */
export function MaybeTooltip({
  collapsed,
  label,
  children,
}: {
  collapsed: boolean;
  label: string;
  children: React.ReactNode;
}) {
  if (!collapsed) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function SidebarLink({
  item,
  active,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  return (
    <MaybeTooltip collapsed={collapsed} label={item.label}>
      <Link
        href={item.href}
        aria-label={collapsed ? item.label : undefined}
        className={cn(
          itemBaseClass,
          collapsed ? "justify-center px-0" : "px-sp-sm",
          active
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        )}
      >
        <Icon className="size-4 shrink-0" strokeWidth={1.75} />
        {!collapsed && item.label}
      </Link>
    </MaybeTooltip>
  );
}

/**
 * An item that shows where something will live without pretending it
 * works. `reason` replaces the label in the tooltip when the item is
 * disabled for a reason worth naming — "Bientôt disponible" — while a
 * collapsed rail still needs the plain label to be readable.
 */
export function SidebarPlaceholderItem({
  label,
  icon: Icon,
  collapsed,
  reason,
}: {
  label: string;
  icon: LucideIcon;
  collapsed: boolean;
  reason?: string;
}) {
  const button = (
    <button
      type="button"
      disabled
      aria-label={collapsed ? label : undefined}
      className={cn(
        itemBaseClass,
        "w-full cursor-default text-muted-foreground/60",
        collapsed ? "justify-center px-0" : "px-sp-sm",
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.75} />
      {!collapsed && label}
    </button>
  );

  if (!reason) {
    return (
      <MaybeTooltip collapsed={collapsed} label={label}>
        {button}
      </MaybeTooltip>
    );
  }

  return (
    <Tooltip>
      {/* A disabled button fires no pointer events, so Radix would never
          see the hover — the span is what the tooltip actually listens on. */}
      <TooltipTrigger asChild>
        <span className="block">{button}</span>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {collapsed ? `${label} — ${reason}` : reason}
      </TooltipContent>
    </Tooltip>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-sp-sm pb-sp-xs text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </p>
  );
}

export function SidebarDivider({ inset = false }: { inset?: boolean }) {
  return <div className={cn("h-px bg-border", inset && "mx-sp-sm")} />;
}

export function AppSidebar({
  defaultCollapsed = false,
  brand,
  beforeNav,
  children,
  footer,
}: {
  defaultCollapsed?: boolean;
  /** Brand lockup; receives `collapsed` so it can fall back to the mark alone. */
  brand: (collapsed: boolean) => React.ReactNode;
  /**
   * Anything between the brand and the nav — search, a feed link. Gets the
   * setter too: the collapsed search box expands the whole sidebar when
   * clicked, rather than opening a field 64px wide.
   */
  beforeNav?: (collapsed: boolean, setCollapsed: (next: boolean) => void) => React.ReactNode;
  children: (collapsed: boolean) => React.ReactNode;
  footer?: (collapsed: boolean) => React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  function setCollapsedAndPersist(next: boolean) {
    setCollapsed(next);
    // Persisted as a cookie rather than localStorage so the layout can
    // read it server-side and render the right width on first paint —
    // localStorage is only readable after hydration, which would flash
    // the expanded sidebar on every load for collapsed users.
    document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; SameSite=Lax`;
  }

  function toggleCollapsed() {
    setCollapsedAndPersist(!collapsed);
  }

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          // Same card treatment as the header — rounded-xl, bg-card,
          // shadow-soft — so the two surfaces read as one system. Height
          // comes from the wrapper stretching it, not h-svh, which would
          // overflow now that the wrapper adds vertical padding.
          "flex shrink-0 flex-col overflow-hidden rounded-xl bg-card shadow-soft",
          "transition-[width] duration-200 ease-in-out print:hidden",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-sp-sm pt-sp-md pb-sp-md",
            collapsed ? "justify-center px-sp-sm" : "px-sp-md",
          )}
        >
          {brand(collapsed)}
          {!collapsed && (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Réduire le menu"
              aria-expanded
              className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="size-3.5" strokeWidth={2} />
            </button>
          )}
        </div>

        {collapsed && (
          <div className="flex justify-center pb-sp-sm">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  aria-label="Étendre le menu"
                  aria-expanded={false}
                  className="flex size-6 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ChevronRight className="size-3.5" strokeWidth={2} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                Étendre le menu
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        {beforeNav?.(collapsed, setCollapsedAndPersist)}

        <nav className="flex-1 space-y-sp-lg overflow-y-auto px-sp-sm pt-sp-md">
          {children(collapsed)}
        </nav>

        {footer && <div className="space-y-sp-xs px-sp-sm pb-sp-md">{footer(collapsed)}</div>}
      </aside>
    </TooltipProvider>
  );
}
