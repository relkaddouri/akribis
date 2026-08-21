import type { Prisma, PrismaClient } from "@/lib/db/generated/client";

/**
 * Écriture dans le journal d'audit `event_log`.
 *
 * Module ordinaire, pas `"use server"` : il exporte des constantes, ce
 * qu'un fichier `"use server"` ne peut pas faire, et il n'est appelé que
 * depuis des façades serveur.
 *
 * Le journal est en **ajout seul**, garanti par un déclencheur en base
 * (migration 20260821090000_event_log). Rien ici ne modifie ni ne
 * supprime d'entrée, et rien ne devrait jamais le faire.
 */

/**
 * Le vocabulaire des actions. En constantes plutôt qu'en chaînes libres :
 * une faute de frappe dans un `type_action` ne se voit pas — l'entrée
 * s'écrit, et c'est la recherche qui, des mois plus tard, ne la trouve
 * pas.
 */
export const TYPES_ACTION = {
  catalogueProduitCree: "catalogue.produit.cree",
  catalogueProduitModifie: "catalogue.produit.modifie",
  catalogueProduitDesactive: "catalogue.produit.desactive",
  catalogueProduitReactive: "catalogue.produit.reactive",
  /** Un des autres drapeaux nationaux : ordonnance, froid, commercialisé. */
  catalogueProduitDrapeau: "catalogue.produit.drapeau_modifie",
} as const;

export type TypeAction = (typeof TYPES_ACTION)[keyof typeof TYPES_ACTION];

/** L'entité visée. Texte libre en base, liste fermée ici. */
export const ENTITES = {
  catalogueProduit: "catalogue_produit",
} as const;

export type Acteur = { id: string; email: string; role: string };

/**
 * Accepte aussi bien le client que le handle d'une transaction : c'est ce
 * qui permet d'écrire l'entrée **dans la même transaction** que l'action
 * qu'elle décrit. Une action commise sans son entrée serait un trou dans
 * le journal, et un journal troué ne se distingue pas d'un journal faux.
 */
export type ClientOuTransaction = PrismaClient | Prisma.TransactionClient;

/**
 * Rend un objet sérialisable en JSONB.
 *
 * Les fiches catalogue portent des `Decimal` et des `Date`, dont aucun
 * n'est du JSON. Un `Decimal` glissé tel quel dans une colonne `Json`
 * arrive en `{}` — l'entrée s'écrit, et l'état « avant » qu'on gardait
 * précisément pour pouvoir comparer est perdu.
 */
export function serialisable(valeur: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(valeur, (_cle, v) =>
      typeof v === "bigint" || (v !== null && typeof v === "object" && "toFixed" in v)
        ? String(v)
        : v,
    ),
  ) as Prisma.InputJsonValue;
}

export async function journaliser(
  db: ClientOuTransaction,
  entree: {
    acteur: Acteur;
    typeAction: TypeAction;
    entite: string;
    entiteId: string;
    /** Nul pour une action nationale — l'Admin n'agit pour aucune officine. */
    pharmacyId?: string | null;
    avant?: unknown;
    apres?: unknown;
  },
): Promise<void> {
  await db.eventLog.create({
    data: {
      acteurId: entree.acteur.id,
      acteurEmail: entree.acteur.email,
      acteurRole: entree.acteur.role,
      typeAction: entree.typeAction,
      entite: entree.entite,
      entiteId: entree.entiteId,
      pharmacyId: entree.pharmacyId ?? null,
      avant: entree.avant === undefined ? undefined : serialisable(entree.avant),
      apres: entree.apres === undefined ? undefined : serialisable(entree.apres),
    },
  });
}

/**
 * Le libellé lisible d'un `type_action`.
 *
 * Le journal se lit d'abord pour répondre à « qui a fait quoi » : le
 * vocabulaire pointé sert aux requêtes, pas à l'œil. Une action inconnue
 * — entrée écrite par une version plus récente — retombe sur son code
 * brut plutôt que de disparaître de l'écran.
 */
export const LIBELLES_ACTION: Record<string, string> = {
  [TYPES_ACTION.catalogueProduitCree]: "Fiche créée",
  [TYPES_ACTION.catalogueProduitModifie]: "Fiche modifiée",
  [TYPES_ACTION.catalogueProduitDesactive]: "Fiche désactivée",
  [TYPES_ACTION.catalogueProduitReactive]: "Fiche réactivée",
  [TYPES_ACTION.catalogueProduitDrapeau]: "Statut modifié",
};

export function libelleAction(typeAction: string): string {
  return LIBELLES_ACTION[typeAction] ?? typeAction;
}

/**
 * Les champs qui ont réellement changé entre l'avant et l'après.
 *
 * Une fiche catalogue porte 43 colonnes ; en afficher 43 pour signaler
 * qu'une seule a bougé revient à ne rien signaler. Les horodatages sont
 * écartés : ils changent à chaque écriture sans rien apprendre.
 */
const CHAMPS_IGNORES = new Set(["updatedAt", "createdAt", "dateAjout"]);

export function champsModifies(
  avant: unknown,
  apres: unknown,
): Array<{ champ: string; avant: unknown; apres: unknown }> {
  const a = (avant ?? {}) as Record<string, unknown>;
  const b = (apres ?? {}) as Record<string, unknown>;
  if (typeof a !== "object" || typeof b !== "object") return [];

  const cles = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (cle) => !CHAMPS_IGNORES.has(cle),
  );

  return cles
    .filter((cle) => JSON.stringify(a[cle]) !== JSON.stringify(b[cle]))
    .map((champ) => ({ champ, avant: a[champ], apres: b[champ] }))
    .sort((x, y) => x.champ.localeCompare(y.champ));
}
