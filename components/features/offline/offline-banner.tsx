"use client";

import { CloudOff } from "lucide-react";
import { useSyncStatus } from "@/components/features/offline/use-sync-status";

/**
 * Standing notice while the connection is down.
 *
 * The service worker makes an already-visited page open again offline, but
 * what it serves is the copy from last time. Without this, a stale order
 * list is indistinguishable from a live one — so the bar says plainly which
 * screens are still trustworthy (Stock and Caisse read from IndexedDB) and
 * which are only a snapshot.
 *
 * Fixed rather than in the flow: the header is sticky to the top of the
 * scroll port, so a banner above it would scroll out of sight exactly when
 * it still applies.
 */
export function OfflineBanner() {
  const { status, pendingCount } = useSyncStatus();
  if (status !== "offline") return null;

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-sp-md z-40 flex justify-center px-sp-md print:hidden"
    >
      <p className="pointer-events-auto flex flex-wrap items-center justify-center gap-sp-sm rounded-4xl bg-foreground px-sp-md py-sp-sm text-sm text-background shadow-card">
        <CloudOff className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
        <span>
          Hors ligne — Stock et Caisse restent utilisables. Les autres écrans affichent la
          dernière version consultée.
        </span>
        {pendingCount > 0 && (
          <span className="font-semibold">
            {pendingCount} écriture{pendingCount > 1 ? "s" : ""} en attente d&apos;envoi
          </span>
        )}
      </p>
    </div>
  );
}
