"use client";

import { useEffect } from "react";
import { setOfflineSession } from "@/lib/offline/session";
import { startSyncEngine, stopSyncEngine } from "@/lib/offline/sync-engine";

export function OfflineProvider({
  pharmacyId,
  userId,
  children,
}: {
  pharmacyId: string;
  userId: string;
  children: React.ReactNode;
}) {
  // Synchronous, during render — not in an effect — so it's guaranteed
  // to run before any child component's own effects or queries, which
  // may call into the offline layer as soon as they mount.
  setOfflineSession(pharmacyId, userId);

  useEffect(() => {
    startSyncEngine();
    return () => stopSyncEngine();
  }, []);

  return <>{children}</>;
}
