"use client";

import { PRODUIT_CATEGORIES, TABLEAUX_SUBSTANCE } from "@/lib/validations/catalogue";
import { SectionTitle, SelectField, SwitchField, TextField } from "./field";
import { CataloguePhotoField } from "./photo-field";
import type { StepProps } from "./types";

/** PRD 5.1 — identification et classification. */
export function StepIdentification({ state, errors, onChange }: StepProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField
        id="nom"
        label="Nom"
        wide
        required
        value={state.nom}
        error={errors.nom}
        placeholder="DOLIPRANE 500 mg"
        onChange={(value) => onChange("nom", value)}
      />
      <TextField
        id="codeBarres"
        label="Code-barres"
        value={state.codeBarres}
        error={errors.codeBarres}
        inputMode="numeric"
        placeholder="6111234567893"
        hint="CIP/CBO ou EAN-13 — identifiant national, unique dans le catalogue"
        onChange={(value) => onChange("codeBarres", value)}
      />
      <TextField
        id="dosage"
        label="Dosage"
        value={state.dosage}
        placeholder="500 mg"
        onChange={(value) => onChange("dosage", value)}
      />
      <TextField
        id="formeGalenique"
        label="Forme galénique"
        required
        value={state.formeGalenique}
        error={errors.formeGalenique}
        placeholder="Comprimé pelliculé"
        onChange={(value) => onChange("formeGalenique", value)}
      />
      <TextField
        id="conditionnement"
        label="Conditionnement"
        value={state.conditionnement}
        placeholder="1 boîte de 16 comprimés"
        onChange={(value) => onChange("conditionnement", value)}
      />
      <TextField
        id="dci"
        label="DCI"
        value={state.dci}
        placeholder="Paracétamol"
        hint="Dénomination commune internationale"
        onChange={(value) => onChange("dci", value)}
      />
      <TextField
        id="laboratoire"
        label="Laboratoire"
        value={state.laboratoire}
        onChange={(value) => onChange("laboratoire", value)}
      />

      <SectionTitle>Classification</SectionTitle>

      <SelectField
        id="categorie"
        label="Catégorie"
        value={state.categorie}
        options={PRODUIT_CATEGORIES}
        placeholder="À classer"
        hint="Détermine le taux de TVA applicable"
        onChange={(value) => onChange("categorie", value)}
      />
      <TextField
        id="classeTherapeutique"
        label="Classe thérapeutique"
        value={state.classeTherapeutique}
        placeholder="Antalgiques / Antipyrétiques"
        onChange={(value) => onChange("classeTherapeutique", value)}
      />
      <SelectField
        id="produitTableau"
        label="Tableau"
        value={state.produitTableau}
        options={TABLEAUX_SUBSTANCE}
        hint="Substances réglementées — conditionne la délivrance"
        onChange={(value) => onChange("produitTableau", value)}
      />
      <TextField
        id="groupeProduits"
        label="Groupe de produits"
        value={state.groupeProduits}
        hint="Regroupe les équivalents entre eux"
        onChange={(value) => onChange("groupeProduits", value)}
      />
      <TextField
        id="gamme"
        label="Gamme"
        value={state.gamme}
        onChange={(value) => onChange("gamme", value)}
      />
      <TextField
        id="sousGamme"
        label="Sous-gamme"
        value={state.sousGamme}
        onChange={(value) => onChange("sousGamme", value)}
      />
      <TextField
        id="referenceLabo"
        label="Référence laboratoire"
        value={state.referenceLabo}
        onChange={(value) => onChange("referenceLabo", value)}
      />

      <SectionTitle>Photos</SectionTitle>

      <CataloguePhotoField value={state.photos} onChange={(photos) => onChange("photos", photos)} />

      <SectionTitle>Statuts</SectionTitle>

      <SwitchField
        label="Nécessite une prescription"
        description="Le produit ne peut être délivré que sur ordonnance."
        checked={state.necessitePrescription}
        onChange={(checked) => onChange("necessitePrescription", checked)}
      />
      <SwitchField
        label="Conservation au froid"
        description="Chaîne du froid à respecter à la réception comme au stockage."
        checked={state.refrigerationRequise}
        onChange={(checked) => onChange("refrigerationRequise", checked)}
      />
      <SwitchField
        label="Produit commercialisé"
        description="Statut réglementaire national : le produit est-il encore autorisé à la vente au Maroc."
        checked={state.produitCommercialise}
        onChange={(checked) => onChange("produitCommercialise", checked)}
      />
      <SwitchField
        label="Actif au catalogue"
        description="Décocher retire la fiche des recherches de toutes les pharmacies, sans rien supprimer."
        checked={state.actifCatalogue}
        onChange={(checked) => onChange("actifCatalogue", checked)}
      />
    </div>
  );
}
