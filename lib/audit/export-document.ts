import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { ENTITES, journaliser, TYPES_ACTION } from "@/lib/audit/event-log";

/**
 * Trace le téléchargement d'un document.
 *
 * Module ordinaire et non `"use server"` : il n'est appelé que depuis des
 * gestionnaires de route, et un fichier `"use server"` n'exporterait pas
 * les constantes qu'il utilise.
 *
 * Aucune capture d'erreur ici, contrairement aux événements de compte : un
 * export qui échoue rend un 500 et le pharmacien recommence, là où une
 * connexion refusée mettrait l'officine à l'arrêt. Et c'est précisément
 * sur les extractions qu'un journal silencieux serait un angle mort.
 *
 * À appeler **après** avoir vérifié que le document existe : journaliser
 * l'export d'un identifiant introuvable inventerait une extraction.
 */
export async function journaliserTelechargement(entree: {
  /** L'un des ENTITES de document : facture, bordereau, bon_commande, bon_livraison. */
  entite: (typeof ENTITES)[keyof typeof ENTITES];
  entiteId: string;
  /** Le numéro affiché du document, pour que le journal se lise sans jointure. */
  nom: string;
}): Promise<void> {
  const user = await requireUser();

  await journaliser(prisma, {
    acteur: { id: user.id, email: user.email, role: user.role },
    typeAction: TYPES_ACTION.documentExporte,
    entite: entree.entite,
    entiteId: entree.entiteId,
    pharmacyId: user.pharmacyId,
    // Ni avant ni après : un export ne change rien. Le nom seul, et le
    // format, pour répondre à « qui a sorti quoi ».
    apres: { nom: entree.nom, format: "PDF" },
  });
}
