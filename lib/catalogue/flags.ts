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
