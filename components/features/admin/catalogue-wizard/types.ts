import type {
  CatalogueFormInput,
  ProduitCategorieValue,
  TableauSubstanceValue,
} from "@/lib/validations/catalogue";
import type { CatalogueProduitRecord } from "@/lib/server/catalogue";

/**
 * Everything the catalogue form holds across steps. Numbers stay strings
 * (the native <input> value type) and are only coerced when the Zod schema
 * parses them — the same convention as the stock product wizard.
 */
export type CatalogueWizardState = {
  // Étape 1 — Identification
  nom: string;
  codeBarres: string;
  dosage: string;
  /** URLs ordonnées ; la première est la photo principale. */
  photos: string[];
  categorie: ProduitCategorieValue | "";
  classeTherapeutique: string;
  formeGalenique: string;
  dci: string;
  laboratoire: string;
  produitTableau: TableauSubstanceValue;
  gamme: string;
  sousGamme: string;
  necessitePrescription: boolean;
  produitCommercialise: boolean;
  groupeProduits: string;
  actifCatalogue: boolean;
  refrigerationRequise: boolean;
  conditionnement: string;
  referenceLabo: string;

  // Étape 2 — Prix et fiscalité
  pph: string;
  ppv: string;
  prixBaseRemboursement: string;
  tvaAchat: string;
  tvaVente: string;
  remboursable: boolean;
  tauxRemboursement: string;

  // Étape 3 — Descriptif
  description: string;
  excipients: string;
  indications: string;
  posologieAdulte: string;
  posologieEnfant: string;
  contreIndicationConduite: string;
  contreIndicationAllaitement: string;
  contreIndicationGrossesse: string;
  monographie: string;
};

export const EMPTY_CATALOGUE_STATE: CatalogueWizardState = {
  nom: "",
  codeBarres: "",
  dosage: "",
  photos: [],
  categorie: "",
  classeTherapeutique: "",
  formeGalenique: "",
  dci: "",
  laboratoire: "",
  produitTableau: "AUCUN",
  gamme: "",
  sousGamme: "",
  necessitePrescription: false,
  produitCommercialise: true,
  groupeProduits: "",
  actifCatalogue: true,
  refrigerationRequise: false,
  conditionnement: "",
  referenceLabo: "",
  pph: "",
  ppv: "",
  prixBaseRemboursement: "",
  tvaAchat: "",
  tvaVente: "",
  remboursable: false,
  tauxRemboursement: "",
  description: "",
  excipients: "",
  indications: "",
  posologieAdulte: "",
  posologieEnfant: "",
  contreIndicationConduite: "",
  contreIndicationAllaitement: "",
  contreIndicationGrossesse: "",
  monographie: "",
};

const text = (value: string | null): string => value ?? "";
const num = (value: number | null): string => (value !== null ? String(value) : "");

export function recordToWizardState(produit: CatalogueProduitRecord): CatalogueWizardState {
  return {
    nom: produit.nom,
    codeBarres: text(produit.codeBarres),
    dosage: text(produit.dosage),
    photos: produit.photos.map((photo) => photo.url),
    categorie: (produit.categorie as ProduitCategorieValue | null) ?? "",
    classeTherapeutique: text(produit.classeTherapeutique),
    formeGalenique: produit.formeGalenique,
    dci: text(produit.dci),
    laboratoire: text(produit.laboratoire),
    produitTableau: produit.produitTableau as TableauSubstanceValue,
    gamme: text(produit.gamme),
    sousGamme: text(produit.sousGamme),
    necessitePrescription: produit.necessitePrescription,
    produitCommercialise: produit.produitCommercialise,
    groupeProduits: text(produit.groupeProduits),
    actifCatalogue: produit.actifCatalogue,
    refrigerationRequise: produit.refrigerationRequise,
    conditionnement: text(produit.conditionnement),
    referenceLabo: text(produit.referenceLabo),
    pph: num(produit.pph),
    ppv: num(produit.ppv),
    prixBaseRemboursement: num(produit.prixBaseRemboursement),
    tvaAchat: num(produit.tvaAchat),
    tvaVente: num(produit.tvaVente),
    remboursable: produit.remboursable,
    tauxRemboursement: num(produit.tauxRemboursement),
    description: text(produit.description),
    excipients: text(produit.excipients),
    indications: text(produit.indications),
    posologieAdulte: text(produit.posologieAdulte),
    posologieEnfant: text(produit.posologieEnfant),
    contreIndicationConduite: text(produit.contreIndicationConduite),
    contreIndicationAllaitement: text(produit.contreIndicationAllaitement),
    contreIndicationGrossesse: text(produit.contreIndicationGrossesse),
    monographie: text(produit.monographie),
  };
}

/** The wizard state is already the schema's input shape, field for field. */
export function toFormInput(state: CatalogueWizardState): CatalogueFormInput {
  return state as CatalogueFormInput;
}

export type StepProps = {
  state: CatalogueWizardState;
  errors: Record<string, string>;
  onChange: <K extends keyof CatalogueWizardState>(
    field: K,
    value: CatalogueWizardState[K],
  ) => void;
};
