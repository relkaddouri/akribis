import { z } from "zod";

/**
 * L'ajout rapide, au comptoir. Nom et téléphone, rien d'autre — et cela ne
 * doit pas changer : ce formulaire s'ouvre en pleine vente, avec un client
 * qui attend. Tout le reste se saisit ensuite depuis la fiche, à tête
 * reposée.
 */
export const clientFormSchema = z.object({
  name: z.string().trim().min(1, "Nom requis"),
  phone: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : null)),
});

export type ClientFormInput = z.input<typeof clientFormSchema>;
export type ClientFormValues = z.output<typeof clientFormSchema>;

export const TYPES_CLIENT = [
  "regulier",
  "occasionnel",
  "professionnel",
] as const;
export type TypeClientValue = (typeof TYPES_CLIENT)[number];

export const LIBELLES_TYPE_CLIENT: Record<TypeClientValue, string> = {
  regulier: "Régulier",
  occasionnel: "Occasionnel",
  professionnel: "Professionnel",
};

/**
 * Une chaîne de formulaire vide vaut « non renseigné », pas « chaîne
 * vide ». Sans cette conversion, effacer un champ y écrirait `""`, que la
 * fiche afficherait comme une valeur — un CIN vide indiscernable d'un CIN
 * absent.
 */
const texteOptionnel = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((valeur) => (valeur ? valeur : null));

/**
 * Le formulaire d'édition de la fiche. Seul endroit où se saisissent le
 * CIN, le médecin traitant, l'affiliation et le plafond.
 */
export const clientEditSchema = z.object({
  name: z.string().trim().min(1, "Nom requis"),
  phone: texteOptionnel,
  email: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((valeur) => (valeur ? valeur : null))
    .refine(
      (valeur) =>
        valeur === null || z.string().email().safeParse(valeur).success,
      {
        message: "E-mail invalide",
      },
    ),
  typeClient: z.enum(TYPES_CLIENT),

  cin: texteOptionnel,
  medecinTraitant: texteOptionnel,

  adresse: texteOptionnel,
  codePostal: texteOptionnel,
  ville: texteOptionnel,
  pays: texteOptionnel,

  numeroImmatriculation: texteOptionnel,
  /** L'organisme est un identifiant, jamais un libellé libre. */
  insurerId: texteOptionnel,

  /**
   * Nul = pas de plafond. Zéro en est un : le titulaire qui l'a saisi
   * refuse tout crédit à ce client.
   */
  plafondCredit: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((valeur) => {
      if (valeur === null || valeur === undefined || valeur === "") return null;
      return Number(valeur);
    })
    .refine(
      (valeur) => valeur === null || (Number.isFinite(valeur) && valeur >= 0),
      {
        message: "Le plafond doit être un montant positif",
      },
    ),
});

export type ClientEditInput = z.input<typeof clientEditSchema>;
export type ClientEditValues = z.output<typeof clientEditSchema>;
