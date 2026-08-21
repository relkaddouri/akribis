/**
 * The boolean fields that can be flipped straight from the sheet or the
 * list, without walking the whole edit form.
 *
 * A closed list, not an arbitrary field name: the toggle action takes its
 * target from the client, and `prisma.update({ data: { [field]: value } })`
 * on an unchecked string would let a crafted POST rewrite any column on a
 * fiche every pharmacy shares.
 *
 * Lives here rather than beside the action because a `"use server"` module
 * may only export async functions — exporting this array from one compiles
 * under `tsc` and fails the production build.
 */
export const TOGGLEABLE_FLAGS = [
  "actifCatalogue",
  "necessitePrescription",
  "refrigerationRequise",
  "produitCommercialise",
] as const;

export type CatalogueFlag = (typeof TOGGLEABLE_FLAGS)[number];

export function isToggleableFlag(value: string): value is CatalogueFlag {
  return (TOGGLEABLE_FLAGS as readonly string[]).includes(value);
}

/**
 * Le `type_action` à journaliser pour une bascule de drapeau.
 *
 * La désactivation d'une fiche n'est pas un changement de drapeau parmi
 * d'autres : c'est elle qui la retire des recherches de toutes les
 * pharmacies de la plateforme, et c'est elle qu'on viendra chercher dans
 * le journal. Elle a donc son propre type — et son inverse aussi, sans
 * quoi « qui a réactivé cette fiche » resterait sans réponse.
 */
export function typeActionDuDrapeau(flag: CatalogueFlag, value: boolean): string {
  if (flag === "actifCatalogue") {
    return value ? "catalogue.produit.reactive" : "catalogue.produit.desactive";
  }
  return "catalogue.produit.drapeau_modifie";
}
