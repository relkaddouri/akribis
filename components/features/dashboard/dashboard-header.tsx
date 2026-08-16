"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Bell, ChevronDown, LogOut, Settings, ShieldCheck, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSyncStatus } from "@/components/features/offline/use-sync-status";
import { syncStatusLabel } from "@/lib/offline/sync-engine";
import { listOutstandingSyncItems, type OutstandingSyncItem } from "@/lib/offline/sync-queue";
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
import { clearCachedPages } from "@/components/providers/service-worker-registrar";
import { clearRememberedCounts } from "@/lib/offline/last-known-counts";

const ROLE_LABELS: Record<string, string> = {
  owner: "Titulaire",
  assistant: "Assistant",
  admin_akribis: "Équipe Akribis",
};

/**
 * Which space the header sits in. The two share the band, the card, the
 * icon chip and the user menu; what differs is what a pharmacy has and
 * Akribis staff don't — the offline sync queue is keyed by pharmacy, and
 * the actualités feed is something they publish rather than read.
 */
export type HeaderSpace = "pharmacy" | "admin";

const SYNC_ITEM_LABELS: Record<SyncOperationType, string> = {
  createSale: "vente",
  updateProduct: "produit modifié",
  createProduct: "nouveau produit",
  receiveOrder: "réception de commande",
  startInventory: "inventaire démarré",
  recordInventoryCount: "comptage d'inventaire",
  applyInventory: "ajustement d'inventaire",
};

/** Counts per operation type, so the panel reads "2 ventes" not two rows. */
function groupByType(items: OutstandingSyncItem[]): Map<SyncOperationType, number> {
  const grouped = new Map<SyncOperationType, number>();
  for (const item of items) {
    grouped.set(item.type, (grouped.get(item.type) ?? 0) + 1);
  }
  return grouped;
}

function SyncGroup({
  title,
  items,
  tone,
}: {
  title: string;
  items: OutstandingSyncItem[];
  tone?: "alert";
}) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-sp-xs px-sp-xs py-sp-xs">
      <p
        className={cn(
          "text-[11px] font-semibold tracking-wide uppercase",
          tone === "alert" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {title}
      </p>
      <ul className="space-y-sp-xs">
        {[...groupByType(items).entries()].map(([type, count]) => (
          <li key={type} className="flex items-center justify-between gap-sp-md text-sm">
            <span className="text-foreground">{SYNC_ITEM_LABELS[type] ?? type}</span>
            <span className="text-muted-foreground">
              {count} {count > 1 ? "éléments" : "élément"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SyncStatusMenu() {
  const { status, pendingCount } = useSyncStatus();
  /**
   * Deliberately NOT `listPendingSyncItems`: that one answers "due for
   * another attempt right now", so writes serving out a retry backoff drop
   * out of it. Listing from it while counting from the whole queue is what
   * made this panel print "6 écritures bloquées" directly above "Aucun
   * élément en attente". One query now feeds both.
   */
  const outstanding = useLiveQuery(() => listOutstandingSyncItems(), []) ?? [];

  const dotColor =
    status === "online" ? "bg-green-500" : status === "syncing" ? "bg-amber-500 animate-pulse" : "bg-gray-400";
  const label = syncStatusLabel(status);

  const stalled = outstanding.filter((item) => item.isStalled);
  const waiting = outstanding.filter((item) => !item.isStalled);
  const stalledCount = stalled.length;

  return (
    <div className="flex items-center gap-sp-xs text-sm">
      <span className={cn("size-2 rounded-full", dotColor)} aria-hidden />
      <span className="text-muted-foreground">{label}</span>

      {pendingCount > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "font-medium underline-offset-2 outline-none hover:underline focus-visible:underline",
                // A write that keeps failing is no longer merely "waiting":
                // it needs someone to look. Nothing is ever dropped, so this
                // notice is the only thing standing between a stuck write
                // and it going unnoticed for days.
                stalledCount > 0 ? "text-destructive" : "text-primary",
              )}
            >
              · {pendingCount} en attente{pendingCount > 1 ? "s" : ""}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>File de synchronisation</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {stalledCount > 0 && (
              <div className="mb-sp-xs flex gap-sp-sm rounded-lg bg-destructive/10 px-sp-sm py-sp-sm text-sm text-destructive">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                <span>
                  <strong className="font-semibold">
                    {stalledCount} écriture{stalledCount > 1 ? "s" : ""} bloquée
                    {stalledCount > 1 ? "s" : ""}
                  </strong>{" "}
                  — les tentatives continuent, mais une vérification manuelle est
                  conseillée.
                </span>
              </div>
            )}

            {outstanding.length === 0 ? (
              <p className="px-sp-xs py-sp-xs text-sm text-muted-foreground">
                Aucun élément en attente.
              </p>
            ) : (
              <>
                <SyncGroup title="En attente d'envoi" items={waiting} />
                <SyncGroup
                  title="En échec — nouvelle tentative programmée"
                  items={stalled}
                  tone="alert"
                />
              </>
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

/**
 * Signing out also drops what was kept on the device for this account:
 * the cached page documents and the remembered badge counts. Left behind,
 * the next person at the counter would be served the previous user's
 * dashboard straight from cache.
 */
async function handleSignOut() {
  clearRememberedCounts();
  await clearCachedPages();
  await signOutAction();
}

function UserMenu({ space }: { space: HeaderSpace }) {
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
        {space === "pharmacy" && user.role === "owner" && (
          <DropdownMenuItem asChild>
            <Link href="/parametres">
              <Settings /> Paramètres du compte
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onClick={() => void handleSignOut()}>
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
  space = "pharmacy",
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
  /** Page-specific controls, e.g. a "Nouvelle commande" button. */
  actions?: React.ReactNode;
  hasUnreadNews?: boolean;
  /** Defaults to the pharmacy; "admin" drops the pharmacy-only controls. */
  space?: HeaderSpace;
}) {
  const isAdmin = space === "admin";
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
      {/* Two zones on one row, separated by exactly `gap-sp-md`. Global
          search moved to the sidebar, so the title block now takes the
          width it used to occupy. */}
      <div className="flex flex-wrap items-center gap-sp-md rounded-xl bg-card px-sp-md py-sp-sm shadow-soft">
        {/* `basis-48` rather than a max-width. In a wrapping flex row the
            browser decides line breaks from each item's *base* size before
            any shrinking happens, so a long title pushed the trailing
            cluster onto a second row no matter how shrinkable this block
            was. A small base keeps the row intact, while `flex-1` lets the
            title spread into the space the search bar has vacated. */}
        <div className="flex min-w-0 flex-1 basis-48 items-center gap-sp-sm">
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

        <div className="ml-auto flex shrink-0 items-center gap-sp-md">
          {actions}
          {isAdmin ? (
            /* Not decoration: the one cue telling whoever is at the keyboard
               that edits here land in every pharmacy's catalogue, not in one
               officine's stock. */
            <span className="hidden items-center gap-sp-xs rounded-lg bg-accent px-sp-sm py-1 text-xs font-medium text-primary sm:inline-flex">
              <ShieldCheck className="size-3.5" strokeWidth={2} aria-hidden />
              Espace Akribis
            </span>
          ) : (
            <>
              <SyncStatusMenu />
              <NotificationsBell hasUnread={hasUnreadNews} />
            </>
          )}
          <UserMenu space={space} />
        </div>
      </div>
    </div>
  );
}
