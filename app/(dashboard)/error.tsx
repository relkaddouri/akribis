"use client";

import { WifiOff, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Catches errors thrown while rendering any page under (dashboard) —
 * notably Prisma calls (e.g. getPharmacySettings, getDashboardStats)
 * failing because the database is unreachable. Those pages have no
 * offline fallback of their own, unlike the Dexie-backed views (POS,
 * stock, clients, commandes), so without this boundary a DB outage
 * crashes the whole page instead of degrading gracefully.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isConnectivityError = /can't reach database server|failed to fetch|network ?error|fetch failed/i.test(
    error.message,
  );

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-sp-md text-center">
      {isConnectivityError ? (
        <WifiOff className="size-10 text-muted-foreground" aria-hidden />
      ) : (
        <TriangleAlert className="size-10 text-muted-foreground" aria-hidden />
      )}
      <div className="space-y-sp-xs">
        <h1 className="text-lg font-medium">
          {isConnectivityError ? "Connexion au serveur indisponible" : "Une erreur est survenue"}
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          {isConnectivityError
            ? "Cette page nécessite une connexion internet. Les ventes et le stock restent utilisables hors-ligne ; réessayez une fois la connexion rétablie."
            : "Le chargement de cette page a échoué. Vous pouvez réessayer."}
        </p>
      </div>
      <Button onClick={() => reset()} variant="outline" size="sm">
        Réessayer
      </Button>
    </div>
  );
}
