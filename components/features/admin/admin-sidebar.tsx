"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  BookMarked,
  Building2,
  CreditCard,
  Lightbulb,
  LogOut,
  ScrollText,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOutAction } from "@/lib/auth/actions";
import { ADMIN_CATALOGUE_PATH, ADMIN_JOURNAL_PATH } from "@/lib/auth/access-control";
import { ThemeToggle } from "@/components/features/dashboard/theme-toggle";
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
  { label: "Catalogue produits", href: ADMIN_CATALOGUE_PATH, icon: BookMarked },
  { label: "Journal d'audit", href: ADMIN_JOURNAL_PATH, icon: ScrollText },
];

/** Where the rest of the back-office will go. No routes yet, by design. */
const UPCOMING_ITEMS = [
  { label: "Suggestions", icon: Lightbulb },
  { label: "Comptes pharmacies", icon: Building2 },
  { label: "Abonnements", icon: CreditCard },
] as const;

const SOON = "Bientôt disponible";

/**
 * The Akribis mark plus a typographic "akribis / Admin" lockup.
 *
 * The delivered logo (public/logo.png, used untouched by BrandLogo) has
 * "Pharma" baked into the artwork, so it cannot serve a space that isn't
 * the pharmacy one. Rather than crop or recolour the designer's file, the
 * mark is kept exactly as-is and only the wordmark is set in the app's own
 * heading face. Drop in an "akribis Admin" PNG here the day there is one.
 */
function AdminBrand({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      <Image src="/icon.svg" alt="Akribis Admin" width={40} height={40} className="size-10 shrink-0" />
    );
  }

  return (
    <span className="flex min-w-0 flex-1 items-center gap-sp-sm">
      <Image src="/icon.svg" alt="" width={34} height={34} className="size-8.5 shrink-0" aria-hidden />
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-heading text-lg font-bold text-foreground">
          akribis
        </span>
        <span className="block truncate text-[11px] font-semibold tracking-wide text-primary uppercase">
          Admin
        </span>
      </span>
    </span>
  );
}

export function AdminSidebar({ defaultCollapsed = false }: { defaultCollapsed?: boolean }) {
  const pathname = usePathname();

  return (
    <AppSidebar
      defaultCollapsed={defaultCollapsed}
      brand={(collapsed) => <AdminBrand collapsed={collapsed} />}
      beforeNav={() => <SidebarDivider inset />}
      footer={(collapsed) => (
        <>
          <SidebarPlaceholderItem
            label="Paramètres"
            icon={Settings}
            collapsed={collapsed}
            reason={SOON}
          />
          <ThemeToggle collapsed={collapsed} />
          <MaybeTooltip collapsed={collapsed} label="Déconnexion">
            <button
              type="button"
              onClick={() => void signOutAction()}
              aria-label={collapsed ? "Déconnexion" : undefined}
              className={cn(
                itemBaseClass,
                "w-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
                collapsed ? "justify-center px-0" : "px-sp-sm",
              )}
            >
              <LogOut className="size-4 shrink-0" strokeWidth={1.75} />
              {!collapsed && "Déconnexion"}
            </button>
          </MaybeTooltip>
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
                  active={pathname.startsWith(item.href)}
                  collapsed={collapsed}
                />
              ))}
            </div>
          </div>

          <SidebarDivider />

          <div>
            {!collapsed && <SectionLabel>À venir</SectionLabel>}
            <div className="space-y-sp-xs">
              {UPCOMING_ITEMS.map((item) => (
                <SidebarPlaceholderItem
                  key={item.label}
                  label={item.label}
                  icon={item.icon}
                  collapsed={collapsed}
                  reason={SOON}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </AppSidebar>
  );
}
