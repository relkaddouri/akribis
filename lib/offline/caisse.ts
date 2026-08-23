import { getDb, type LocalCaisseSession } from "@/lib/offline/db";
import { getOfflinePharmacyId } from "@/lib/offline/session";
import { enqueue } from "@/lib/offline/sync-queue";
import { processQueue } from "@/lib/offline/sync-engine";

/**
 * L'ouverture de caisse, côté appareil.
 *
 * Le pharmacien lève le rideau, la connexion n'est pas encore revenue, et
 * il doit pouvoir vendre. L'ouverture s'écrit donc localement d'abord et
 * part au serveur ensuite — même mécanisme que les ventes et les
 * inventaires, avec le même identifiant fabriqué ici : le rejeu retrouve
 * la session déjà posée et ne crée pas de doublon.
 *
 * **L'ouverture seulement.** La clôture reste en ligne : elle additionne
 * les ventes de la session pour en tirer le montant théorique, et un
 * appareil hors ligne n'en connaît que les siennes — celles passées sur le
 * poste d'à côté lui manquent. Un Z calculé sur une moitié de journée
 * serait faux, et figé une fois écrit.
 *
 * L'ordre de la file fait le reste : l'ouverture est mise en file avant
 * toute vente de la journée, donc elle atteint le serveur la première. Si
 * une vente la devançait malgré tout, le serveur la refuserait avec
 * « Caisse non ouverte » — un message que le moteur ne classe pas comme
 * refus définitif, donc la vente attend et repasse.
 */

/** La session ouverte sur cet appareil, synchronisée ou non. */
export async function getSessionLocale(): Promise<LocalCaisseSession | null> {
  const pharmacyId = getOfflinePharmacyId();
  const sessions = await getDb()
    .caisseSessions.where("pharmacyId")
    .equals(pharmacyId)
    .toArray();

  // La plus récente : une session synchronisée puis clôturée est retirée
  // par `oublierSessionLocale`, mais un appareil resté longtemps hors
  // ligne peut en porter plusieurs.
  return (
    sessions.sort((a, b) => b.dateOuverture.getTime() - a.dateOuverture.getTime())[0] ?? null
  );
}

export async function ouvrirCaisseHorsLigne(input: {
  fondCaisseInitial: number;
  ouvreurNom: string;
}): Promise<LocalCaisseSession> {
  const pharmacyId = getOfflinePharmacyId();
  const id = crypto.randomUUID();
  const dateOuverture = new Date();

  const session: LocalCaisseSession = {
    id,
    pharmacyId,
    fondCaisseInitial: input.fondCaisseInitial,
    dateOuverture,
    ouvreurNom: input.ouvreurNom,
    syncStatus: "pending",
  };

  await getDb().caisseSessions.put(session);

  await enqueue({
    type: "ouvrirCaisse",
    entityId: id,
    payload: {
      id,
      fondCaisseInitial: input.fondCaisseInitial,
      // L'heure d'ouverture réelle, celle du rideau levé. Sans elle, une
      // session ouverte à 8 h et synchronisée à 11 h serait datée de 11 h,
      // et le Z annoncerait une journée de trois heures plus courte.
      dateOuverture: dateOuverture.toISOString(),
    },
    clientTimestamp: dateOuverture,
  });
  void processQueue();

  return session;
}

/**
 * Retire la session locale une fois qu'elle n'a plus lieu d'être.
 *
 * Appelée quand le serveur dit qu'aucune session n'est ouverte alors que
 * l'appareil en garde une : elle a été clôturée ailleurs, depuis un autre
 * poste. La garder ferait croire à ce comptoir que la caisse est encore
 * ouverte, et les ventes qu'il enverrait seraient refusées une à une.
 */
export async function oublierSessionLocale(id: string): Promise<void> {
  await getDb().caisseSessions.delete(id);
}
