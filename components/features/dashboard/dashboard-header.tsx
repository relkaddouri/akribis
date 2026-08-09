"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Bell, ChevronDown, LogOut, Search, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSyncStatus } from "@/components/features/offline/use-sync-status";
import { listPendingSyncItems } from "@/lib/offline/sync-queue";
import type { SyncOperationType } from "@/lib/offline/db";
import { useDashboardUser } from "@/components/providers/dashboard-user-provider";
import { AvatarBadge } from "@/components/ui/avatar-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/lib/auth/actions";

const ROLE_LABELS: Record<string, string> = {
  owner: "Titulaire",
  assistant: "Assistant",
};

const SYNC_ITEM_LABELS: Record<SyncOperationType, string> = {
  createSale: "vente",
  updateProduct: "produit modifié",
  createProduct: "nouveau produit",
  receiveOrder: "réception de commande",
};

const SEARCH_PLACEHOLDERS = [
  'Essayez "Nouvelle vente"...',
  'Essayez "Doliprane 500mg"...',
  'Essayez "Ajouter un client"...',
  'Essayez "Commandes en attente"...',
];

const PLACEHOLDER_ROTATE_MS = 3500;

function GlobalSearchBar() {
  const [search, setSearch] = useState("");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(
      () => setPlaceholderIndex((i) => (i + 1) % SEARCH_PLACEHOLDERS.length),
      PLACEHOLDER_ROTATE_MS,
    );
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex w-full items-center gap-sp-sm rounded-lg bg-muted/60 px-sp-sm py-sp-xs text-sm text-muted-foreground transition-colors focus-within:bg-muted">
      <Search className="size-4 shrink-0" strokeWidth={1.75} />
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={SEARCH_PLACEHOLDERS[placeholderIndex]}
        aria-label="Recherche globale"
        className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
      />
      <kbd className="hidden shrink-0 rounded-md border border-border bg-card px-sp-xs py-sp-xs text-[10px] font-medium text-muted-foreground sm:inline-block">
        ⌘K
      </kbd>
    </div>
  );
}

function SyncStatusMenu() {
  const { status, pendingCount } = useSyncStatus();
  const pendingItems = useLiveQuery(() => listPendingSyncItems(), []);

  const dotColor =
    status === "online" ? "bg-green-500" : status === "syncing" ? "bg-amber-500 animate-pulse" : "bg-gray-400";
  const label = status === "offline" ? "Hors ligne" : status === "syncing" ? "Synchronisation..." : "En ligne";

  const grouped = new Map<SyncOperationType, number>();
  for (const item of pendingItems ?? []) {
    grouped.set(item.type, (grouped.get(item.type) ?? 0) + 1);
  }

  return (
    <div className="flex items-center gap-sp-xs text-sm">
      <span className={cn("size-2 rounded-full", dotColor)} aria-hidden />
      <span className="text-muted-foreground">{label}</span>

      {pendingCount > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:underline"
            >
              · {pendingCount} en attente{pendingCount > 1 ? "s" : ""}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>File de synchronisation</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {grouped.size === 0 ? (
              <p className="px-sp-xs py-sp-xs text-sm text-muted-foreground">Aucun élément en attente.</p>
            ) : (
              <ul className="space-y-sp-xs">
                {[...grouped.entries()].map(([type, count]) => (
                  <li key={type} className="flex items-center justify-between gap-sp-md px-sp-xs py-sp-xs text-sm">
                    <span className="text-foreground">{SYNC_ITEM_LABELS[type] ?? type}</span>
                    <span className="text-muted-foreground">
                      {count} {count > 1 ? "éléments" : "élément"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function NotificationsBell({ hasUnread }: { hasUnread: boolean }) {
  return (
    // Fil d'actualité isn't built yet (see the disabled sidebar item) — this
    // is presentational only until there's real publication/read-state data
    // to drive `hasUnread`.
    <button
      type="button"
      className="relative flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      aria-label="Notifications"
    >
      <Bell className="size-4.5" strokeWidth={1.75} />
      {hasUnread && (
        <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-destructive ring-2 ring-card" aria-hidden />
      )}
    </button>
  );
}

function UserMenu() {
  const user = useDashboardUser();
  const displayName = user.name ?? user.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-sp-sm rounded-lg p-sp-xs text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted"
        >
          <AvatarBadge name={displayName} />
          <span className="hidden sm:block">
            <span className="block text-sm font-medium text-foreground">{displayName}</span>
            <span className="block text-xs text-muted-foreground">{ROLE_LABELS[user.role] ?? user.role}</span>
          </span>
          <ChevronDown className="hidden size-4 shrink-0 text-muted-foreground sm:block" strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>
          <span className="block text-sm font-medium text-foreground">{displayName}</span>
          <span className="block text-xs font-normal text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {user.role === "owner" && (
          <DropdownMenuItem asChild>
            <Link href="/parametres">
              <Settings /> Paramètres du compte
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onClick={() => void signOutAction()}>
          <LogOut /> Déconnexion
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DashboardHeader({
  title,
  subtitle,
  icon,
  backHref,
  backLabel,
  actions,
  hasUnreadNews = false,
}: {
  title: string;
  /** Secondary line under the title — a phone number, an order date, ... */
  subtitle?: React.ReactNode;
  /**
   * Rendered lucide element, e.g. `<Package />` — not the component
   * itself: a Server Component page can't pass a function across the
   * RSC boundary, but an already-rendered element serializes fine.
   * Sizing is applied here so callers don't repeat it.
   */
  icon: React.ReactNode;
  /**
   * Parent page to return to. Every detail screen routes its "back"
   * through here instead of hand-rolling a "← Section" link, so the
   * affordance sits in the same place and behaves the same everywhere.
   */
  backHref?: string;
  /** Names the destination for screen readers, e.g. "Commandes". */
  backLabel?: string;
  /** Page-specific controls (e.g. a "Nouvelle vente" button) shown next to the search bar. */
  actions?: React.ReactNode;
  hasUnreadNews?: boolean;
}) {
  return (
    /* Sticky band rather than a bare sticky card. The band is opaque
       (`bg-background`) and bleeds past the content wrapper's horizontal
       padding (`-mx-sp-lg px-sp-lg`), so content scrolling underneath is
       hidden right up to the edges instead of showing through the gutters
       and around the card's rounded corners. `pt-sp-lg` supplies the top
       page padding that <main>'s wrapper deliberately no longer carries,
       and keeps the card visually detached from the top edge once pinned.
       z-30 sits above page content while staying below Radix portals
       (dropdowns/tooltips render at z-50). */
    <div className="sticky top-0 z-30 -mx-sp-lg bg-background px-sp-lg pt-sp-lg print:static print:hidden">
      {/* Three zones on one row, separated by exactly `gap-sp-md`. The
          search zone grows but stops at `max-w-md`; previously the wrapper
          was `flex-1` with no cap while the bar inside it capped itself,
          so on wide screens the wrapper kept growing around a fixed-width
          input and opened a dead gap in the middle of the header. */}
      <div className="flex flex-wrap items-center gap-sp-md rounded-xl bg-card px-sp-md py-sp-sm shadow-soft">
        <div className="flex min-w-0 shrink-0 items-center gap-sp-sm">
          {backHref && (
            <Link
              href={backHref}
              aria-label={backLabel ? `Retour vers ${backLabel}` : "Retour"}
              title={backLabel ? `Retour vers ${backLabel}` : "Retour"}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="size-4" strokeWidth={2} />
            </Link>
          )}
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-primary [&_svg]:size-5">
            {icon}
          </span>
          <div className="min-w-0 leading-tight">
            <h1 className="truncate font-heading text-xl font-bold text-foreground">{title}</h1>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>

        {/* Sized, not grown. `flex-1` collapses here: the trailing cluster's
            `ml-auto` consumes all free space before flex-grow is applied,
            so the field would shrink to its icons. A fixed width with
            shrink disabled keeps it predictable instead of stretching. */}
        <div className="order-3 w-full sm:order-none sm:w-96 sm:shrink-0">
          <GlobalSearchBar />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-sp-md">
          {actions}
          <SyncStatusMenu />
          <NotificationsBell hasUnread={hasUnreadNews} />
          <UserMenu />
        </div>
      </div>
    </div>
  );
}
