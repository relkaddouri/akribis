"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  BarChart3,
  Boxes,
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
import { BrandLogo } from "@/components/ui/brand-logo";
import type { Role } from "@/lib/auth/roles";
import { ThemeToggle } from "@/components/features/dashboard/theme-toggle";
import { GlobalSearch } from "@/components/features/dashboard/global-search";
import { useDashboardCounts } from "@/components/features/dashboard/use-dashboard-counts";
import {
  AKRIBIS_TOOLS,
  SIDEBAR_TOOL_ORDER,
  type AkribisTool,
} from "@/components/features/dashboard/akribis-tools";
import { NEWS_PATH, REMINDERS_PATH } from "@/lib/auth/access-control";
import {
  AppSidebar,
  MaybeTooltip,
  SectionLabel,
  SidebarDivider,
  SidebarLink,
  SidebarPlaceholderItem,
  itemBaseClass,
  type NavItem,
} from "@/components/ui/app-sidebar";

const MENU_ITEMS: NavItem[] = [
  { label: "Tableau de bord", href: "/dashboard", icon: LayoutDashboard },
  { label: "Stock", href: "/dashboard/stock", icon: Package },
  { label: "Caisse", href: "/dashboard/pos", icon: ShoppingCart },
  { label: "Ventes", href: "/ventes", icon: Receipt },
  { label: "Clients", href: "/dashboard/clients", icon: Users },
  { label: "Commandes", href: "/commandes", icon: ClipboardList },
  { label: "Factures", href: "/factures", icon: FileText },
];

const INVENTORY_ITEM: NavItem = { label: "Inventaire", href: "/inventaire", icon: Boxes };

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
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full",
                tool.circleClass,
              )}
            >
              <ArrowUpRight className="size-3" strokeWidth={2} />
            </span>
          </>
        )}
      </button>
    </MaybeTooltip>
  );
}

export function DashboardSidebar({
  role,
  defaultCollapsed = false,
}: {
  role: Role;
  defaultCollapsed?: boolean;
}) {
  const pathname = usePathname();
  // Fetched here rather than handed down by the layout: the shell must be
  // able to render from cache with no network, which it could not do while
  // these two numbers were awaited server-side on every navigation.
  const { unreadNews: unreadNewsCount, dueReminders: dueRemindersCount } = useDashboardCounts();

  return (
    <AppSidebar
      defaultCollapsed={defaultCollapsed}
      brand={(collapsed) =>
        /* Collapsed there is no room for the lockup, and the mark alone is
           what the 64px rail can hold. Expanded, the logo already carries
           "akribis Pharma", so text beside it would repeat itself. */
        collapsed ? (
          <Image src="/icon.svg" alt="Akribis" width={40} height={40} className="size-10 shrink-0" />
        ) : (
          <BrandLogo height={34} className="flex-1" />
        )
      }
      beforeNav={(collapsed, setCollapsed) => (
        <>
          <div className="px-sp-sm pb-sp-sm">
            <GlobalSearch collapsed={collapsed} onExpand={() => setCollapsed(false)} />
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

          <SidebarDivider inset />
        </>
      )}
      footer={(collapsed) => (
        <>
          {role === "owner" && (
            <SidebarLink
              item={{ label: "Paramètres", href: "/parametres", icon: Settings }}
              active={isActivePath(pathname, "/parametres")}
              collapsed={collapsed}
            />
          )}
          <SidebarPlaceholderItem label="Support" icon={LifeBuoy} collapsed={collapsed} />
          <ThemeToggle collapsed={collapsed} />
        </>
      )}
    >
      {(collapsed) => (
        <>
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
              <SidebarLink
                item={INVENTORY_ITEM}
                active={isActivePath(pathname, INVENTORY_ITEM.href)}
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

          <SidebarDivider />

          <div>
            {!collapsed && <SectionLabel>Outils</SectionLabel>}
            <div className="space-y-sp-xs">
              {TOOL_ITEMS.map((tool) => (
                <ToolLink key={tool.label} tool={tool} collapsed={collapsed} />
              ))}
            </div>
          </div>
        </>
      )}
    </AppSidebar>
  );
}
