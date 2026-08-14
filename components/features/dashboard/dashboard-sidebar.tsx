"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  BarChart3,
  Boxes,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LifeBuoy,
  type LucideIcon,
  Package,
  BellRing,
  Receipt,
  Rss,
  Settings,
  ShoppingCart,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/auth/roles";
import { ThemeToggle } from "@/components/features/dashboard/theme-toggle";
import { GlobalSearch } from "@/components/features/dashboard/global-search";
import { SIDEBAR_COLLAPSED_COOKIE } from "@/components/features/dashboard/sidebar-cookie";
import {
  AKRIBIS_TOOLS,
  SIDEBAR_TOOL_ORDER,
  type AkribisTool,
} from "@/components/features/dashboard/akribis-tools";
import { NEWS_PATH, REMINDERS_PATH } from "@/lib/auth/access-control";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

const MENU_ITEMS: NavItem[] = [
  { label: "Tableau de bord", href: "/dashboard", icon: LayoutDashboard },
  { label: "Stock", href: "/dashboard/stock", icon: Package },
  { label: "Caisse", href: "/dashboard/pos", icon: ShoppingCart },
  { label: "Ventes", href: "/ventes", icon: Receipt },
  { label: "Clients", href: "/dashboard/clients", icon: Users },
  { label: "Commandes", href: "/commandes", icon: ClipboardList },
  { label: "Factures", href: "/factures", icon: FileText },
];

/**
 * Not yet built (no route) — rendered disabled, same as before. Kept in
 * the Menu section so the existing order is preserved.
 */
const INVENTORY_ITEM = { label: "Inventaire", icon: Boxes };

const REPORTS_ITEM: NavItem = { label: "Rapports", href: "/dashboard/stats", icon: BarChart3 };

/**
 * Upcoming companion products — placeholders with no route yet. Icons and
 * colours come from the shared AKRIBIS_TOOLS map so a tool looks the same
 * here and on the actualités feed's Suite badges.
 */
const TOOL_ITEMS = SIDEBAR_TOOL_ORDER.map((key) => AKRIBIS_TOOLS[key]);

function isActivePath(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname.startsWith(href);
}

/** Wraps an item in a tooltip only while collapsed, when its label is hidden. */
function MaybeTooltip({
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
      <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
    </Tooltip>
  );
}

const itemBaseClass =
  "flex items-center gap-sp-sm rounded-lg py-sp-sm text-sm font-medium transition-colors";

function SidebarLink({
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
          active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        )}
      >
        <Icon className="size-4 shrink-0" strokeWidth={1.75} />
        {!collapsed && item.label}
      </Link>
    </MaybeTooltip>
  );
}

/** A nav item carrying a count badge, e.g. reminders due today. */
function CountedSidebarLink({
  href,
  label,
  icon: Icon,
  count,
  active,
  collapsed,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  count: number;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <MaybeTooltip collapsed={collapsed} label={label}>
      <Link
        href={href}
        aria-label={collapsed ? label : undefined}
        className={cn(
          itemBaseClass,
          collapsed ? "justify-center px-0" : "px-sp-sm",
          active
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        )}
      >
        <span className="relative flex shrink-0 items-center justify-center">
          <Icon className="size-4" strokeWidth={1.75} />
          {/* Collapsed, the number has nowhere to go — a dot still says
              "something needs attention". */}
          {collapsed && count > 0 && (
            <span className="absolute -top-1 -right-1 size-2 rounded-full bg-destructive ring-2 ring-card" />
          )}
        </span>
        {!collapsed && (
          <>
            <span className="flex-1 text-left">{label}</span>
            {count > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-sp-xs text-[11px] font-semibold text-white">
                {count}
              </span>
            )}
          </>
        )}
      </Link>
    </MaybeTooltip>
  );
}

function SidebarPlaceholderItem({
  label,
  icon: Icon,
  collapsed,
}: {
  label: string;
  icon: LucideIcon;
  collapsed: boolean;
}) {
  return (
    <MaybeTooltip collapsed={collapsed} label={label}>
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
    </MaybeTooltip>
  );
}

function ToolLink({ tool, collapsed }: { tool: AkribisTool; collapsed: boolean }) {
  const Icon = tool.icon;
  return (
    <MaybeTooltip collapsed={collapsed} label={tool.label}>
      <button
        type="button"
        disabled
        aria-label={collapsed ? tool.label : undefined}
        className={cn(
          itemBaseClass,
          "w-full cursor-default text-muted-foreground hover:bg-muted/60",
          collapsed ? "justify-center px-0" : "px-sp-sm",
        )}
      >
        <Icon className={cn("size-4 shrink-0", tool.iconClass)} strokeWidth={1.75} />
        {!collapsed && (
          <>
            <span className="flex-1 text-left">{tool.label}</span>
            <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", tool.circleClass)}>
              <ArrowUpRight className="size-3" strokeWidth={2} />
            </span>
          </>
        )}
      </button>
    </MaybeTooltip>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-sp-sm pb-sp-xs text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </p>
  );
}

export function DashboardSidebar({
  role,
  defaultCollapsed = false,
  unreadNewsCount = 0,
  dueRemindersCount = 0,
}: {
  role: Role;
  defaultCollapsed?: boolean;
  /** Unread "Akribis actualités" publications. */
  unreadNewsCount?: number;
  /** Reminders due today or already late — the ones needing a call now. */
  dueRemindersCount?: number;
}) {
  const pathname = usePathname();
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
          "flex h-svh shrink-0 flex-col bg-card transition-[width] duration-200 ease-in-out print:hidden",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <div className={cn("flex items-center gap-sp-sm pt-sp-lg pb-sp-md", collapsed ? "justify-center px-sp-sm" : "px-sp-md")}>
          <Image src="/icon.svg" alt="" width={40} height={40} className="size-10 shrink-0" />
          {!collapsed && (
            <div className="flex-1 leading-tight">
              <span className="block font-heading text-lg font-semibold text-foreground">Akribis</span>
              <span className="block text-xs text-muted-foreground">Pharma</span>
            </div>
          )}
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
              <TooltipContent side="right" sideOffset={8}>Étendre le menu</TooltipContent>
            </Tooltip>
          </div>
        )}

        <div className="px-sp-sm pb-sp-sm">
          <GlobalSearch collapsed={collapsed} onExpand={() => setCollapsedAndPersist(false)} />
        </div>

        <div className="px-sp-sm pb-sp-sm">
          <MaybeTooltip collapsed={collapsed} label="Akribis actualités">
            <Link
              href={NEWS_PATH}
              aria-label={collapsed ? "Akribis actualités" : undefined}
              className={cn(
                itemBaseClass,
                "w-full",
                collapsed ? "justify-center px-0" : "px-sp-sm",
                isActivePath(pathname, NEWS_PATH)
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <span className="relative flex shrink-0 items-center justify-center">
                <Rss className="size-4" strokeWidth={1.75} />
                {collapsed && unreadNewsCount > 0 && (
                  <span className="absolute -top-1 -right-1 size-2 rounded-full bg-destructive ring-2 ring-card" />
                )}
              </span>
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">Akribis actualités</span>
                  {unreadNewsCount > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-sp-xs text-[11px] font-semibold text-white">
                      {unreadNewsCount}
                    </span>
                  )}
                </>
              )}
            </Link>
          </MaybeTooltip>
        </div>

        <div className="mx-sp-sm h-px bg-border" />

        <nav className="flex-1 space-y-sp-lg overflow-y-auto px-sp-sm pt-sp-md">
          <div>
            {!collapsed && <SectionLabel>Menu</SectionLabel>}
            <div className="space-y-sp-xs">
              {MENU_ITEMS.map((item) => (
                <SidebarLink
                  key={item.href}
                  item={item}
                  active={isActivePath(pathname, item.href)}
                  collapsed={collapsed}
                />
              ))}
              <CountedSidebarLink
                href={REMINDERS_PATH}
                label="Rappels"
                icon={BellRing}
                count={dueRemindersCount}
                active={isActivePath(pathname, REMINDERS_PATH)}
                collapsed={collapsed}
              />
              <SidebarPlaceholderItem
                label={INVENTORY_ITEM.label}
                icon={INVENTORY_ITEM.icon}
                collapsed={collapsed}
              />
              {role === "owner" && (
                <SidebarLink
                  item={REPORTS_ITEM}
                  active={isActivePath(pathname, REPORTS_ITEM.href)}
                  collapsed={collapsed}
                />
              )}
            </div>
          </div>

          <div className="h-px bg-border" />

          <div>
            {!collapsed && <SectionLabel>Outils</SectionLabel>}
            <div className="space-y-sp-xs">
              {TOOL_ITEMS.map((tool) => (
                <ToolLink key={tool.label} tool={tool} collapsed={collapsed} />
              ))}
            </div>
          </div>
        </nav>

        <div className="space-y-sp-xs px-sp-sm pb-sp-md">
          {role === "owner" && (
            <SidebarLink
              item={{ label: "Paramètres", href: "/parametres", icon: Settings }}
              active={isActivePath(pathname, "/parametres")}
              collapsed={collapsed}
            />
          )}
          <SidebarPlaceholderItem label="Support" icon={LifeBuoy} collapsed={collapsed} />
          <ThemeToggle collapsed={collapsed} />
        </div>
      </aside>
    </TooltipProvider>
  );
}
