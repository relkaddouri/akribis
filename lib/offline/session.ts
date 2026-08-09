/**
 * Bridges the server-derived session (pharmacyId, userId) into plain
 * modules that aren't React components and so can't read it from a
 * context. `OfflineProvider` sets this once, synchronously, during its
 * own render — before any child component's effects or queries can run.
 */

let pharmacyId: string | null = null;
let userId: string | null = null;

export function setOfflineSession(nextPharmacyId: string, nextUserId: string) {
  pharmacyId = nextPharmacyId;
  userId = nextUserId;
}

export function clearOfflineSession() {
  pharmacyId = null;
  userId = null;
}

export function getOfflinePharmacyId(): string {
  if (!pharmacyId) {
    throw new Error("Offline session not initialized — is OfflineProvider mounted?");
  }
  return pharmacyId;
}

export function getOfflineUserId(): string {
  if (!userId) {
    throw new Error("Offline session not initialized — is OfflineProvider mounted?");
  }
  return userId;
}
