"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { DetailGroup, DetailRow, YesNo } from "@/components/ui/detail-list";
import { CategorieBadge } from "@/components/features/catalogue/categorie-badge";
import { estRenseigne, profilDe } from "@/lib/catalogue/profil-fiche";
import type { CatalogueFiche } from "@/lib/server/stock-entry";

/**
 * La fiche catalogue, en lecture seule, au moment de l'ajouter au stock.
 *
 * L'écran affiche « Vérifiez ces informations avant de les ajouter à votre
 * stock » : il faut donc qu'il y ait quelque chose à vérifier. La carte
 * précédente montrait dosage, laboratoire, DCI et PPV — les quatre champs
 * d'un médicament. Sur une huile essentielle, les quatre sont vides : le
 * pharmacien ajoutait un produit sans en voir le prix.
 *
 * Deux règles, les mêmes que sur les fiches détail :
 *
 *   - les sections suivent la famille (`profilDe`) ;
 *   - **un champ renseigné n'est jamais caché** — ce que la famille ne
 *     prévoit pas remonte sous « Autres informations ».
 *
 * Et une règle propre à cet écran : un champ vide ne s'affiche pas du
 * tout. Ailleurs un tiret dit « rien ici, et c'est normal » ; ici, sur une
 * fiche dont vingt-six champs sur quarante-trois sont vides, vingt-six
 * tirets enterreraient les dix-sept qui comptent.
 *
 * Lecture seule, volontairement : la copie appartient à l'officine et se
 * modifie depuis la fiche produit, une fois le produit au stock. La
 * rendre modifiable ici inviterait à corriger à la réception, avant toute
 * vente et sans raison, ce qui n'éloigne la copie du national sans rien
 * apporter.
 */

function dirham(value: number | null): string | null {
  if (value === null) return null;
  return `${value.toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
}

function pourcent(value: number | null): string | null {
  return value === null ? null : `${value} %`;
}

/** N'affiche la ligne que si la valeur existe — voir l'en-tête du fichier. */
function Ligne({
  label,
  value,
  prose,
}: {
  label: string;
  value: React.ReactNode;
  prose?: boolean;
}) {
  if (!estRenseigne(value)) return null;
  return <DetailRow label={label} value={value} prose={prose} />;
}

/** Un booléen ne se juge pas « renseigné » : `false` est une information. */
function LigneOuiNon({ label, value }: { label: string; value: boolean }) {
  return <DetailRow label={label} value={<YesNo value={value} />} />;
}

export function FicheRecapitulatif({ fiche }: { fiche: CatalogueFiche }) {
  const [tout, setTout] = useState(false);
  const estPara = profilDe(fiche.categorie) === "parapharmacie";

  // `produitTableau` n'est jamais vide — la colonne vaut AUCUN par défaut.
  // Or AUCUN est précisément l'absence de classement : l'afficher mettrait
  // une ligne de bruit sur chaque fiche, et noierait les rares A, B et C,
  // qui eux changent la façon de délivrer le produit.
  const tableau =
    fiche.produitTableau && fiche.produitTableau !== "AUCUN"
      ? `Tableau ${fiche.produitTableau}`
      : null;

  const sousTitre = estPara
    ? [fiche.marque, fiche.categoriePrincipale, fiche.sousCategorie].filter(Boolean).join(" · ")
    : [fiche.dosage, fiche.formeGalenique, fiche.laboratoire].filter(Boolean).join(" · ");

  // Ce qui reste sous le pli : tout ce qui est renseigné et n'est pas déjà
  // au-dessus. Compté plutôt qu'estimé, pour que le libellé du bouton dise
  // la vérité sur cette fiche-là et pas sur une fiche moyenne.
  const complements: [string, React.ReactNode, boolean?][] = estPara
    ? [
        ["Code-barres", fiche.codeBarres],
        ["Conditionnement", fiche.conditionnement],
        ["Sous-sous-catégorie", fiche.sousSousCategorie],
        ["Étiquettes", fiche.etiquettes],
        // La forme galénique n'est pas dans le sous-titre d'un produit
        // para — sans ces lignes elle serait simplement perdue.
        ["Forme galénique", fiche.formeGalenique],
        ["Classe thérapeutique", fiche.classeTherapeutique],
        ["Gamme", fiche.gamme],
        ["Sous-gamme", fiche.sousGamme],
        ["Groupe de produits", fiche.groupeProduits],
        ["Référence laboratoire", fiche.referenceLabo],
        ["Substance réglementée", tableau],
        ["Laboratoire", fiche.laboratoire],
        ["DCI", fiche.dci],
        ["Dosage", fiche.dosage],
        ["PPV", dirham(fiche.ppv)],
        ["PPH", dirham(fiche.pph)],
        ["TVA vente", pourcent(fiche.tvaVente)],
        ["TVA achat", pourcent(fiche.tvaAchat)],
        ["Indications", fiche.indications, true],
        ["Posologie adulte", fiche.posologieAdulte, true],
        ["Excipients", fiche.excipients, true],
        ["Monographie", fiche.monographie, true],
      ]
    : [
        ["Classe thérapeutique", fiche.classeTherapeutique],
        ["Conditionnement", fiche.conditionnement],
        ["Gamme", fiche.gamme],
        ["Sous-gamme", fiche.sousGamme],
        ["Groupe de produits", fiche.groupeProduits],
        ["Référence laboratoire", fiche.referenceLabo],
        ["Marque", fiche.marque],
        ["Rayon", fiche.categoriePrincipale],
        ["Prix de vente indicatif", dirham(fiche.prixVenteIndicatif)],
        ["Description", fiche.description, true],
        ["Indications", fiche.indications, true],
        ["Excipients", fiche.excipients, true],
        ["Posologie adulte", fiche.posologieAdulte, true],
        ["Posologie enfant", fiche.posologieEnfant, true],
        ["Contre-indication — conduite", fiche.contreIndicationConduite, true],
        ["Contre-indication — grossesse", fiche.contreIndicationGrossesse, true],
        ["Contre-indication — allaitement", fiche.contreIndicationAllaitement, true],
        ["Monographie", fiche.monographie, true],
      ];

  const restants = complements.filter(([, valeur]) => estRenseigne(valeur));

  return (
    <div className="space-y-sp-md">
      <div className="space-y-sp-xs">
        <p className="font-heading text-base font-bold text-foreground">{fiche.nom}</p>
        {sousTitre && <p className="text-sm text-muted-foreground">{sousTitre}</p>}
        <CategorieBadge categorie={fiche.categorie} />
      </div>

      <DetailGroup title="Ce qui sera recopié dans votre stock">
        {estPara ? (
          <>
            <Ligne label="Marque" value={fiche.marque} />
            <Ligne label="Rayon" value={fiche.categoriePrincipale} />
            <Ligne label="Sous-catégorie" value={fiche.sousCategorie} />
            {/* Le seul prix que porte une fiche para. La carte précédente
                cherchait le PPV, réglementé et vide ici : le produit
                s'ajoutait sans qu'aucun prix n'ait été montré. */}
            <Ligne label="Prix de vente indicatif" value={dirham(fiche.prixVenteIndicatif)} />
            <Ligne label="Description" value={fiche.description} prose />
          </>
        ) : (
          <>
            <Ligne label="DCI" value={fiche.dci} />
            <Ligne label="Laboratoire" value={fiche.laboratoire} />
            <Ligne label="Forme galénique" value={fiche.formeGalenique} />
            <Ligne label="Dosage" value={fiche.dosage} />
            <Ligne label="Code-barres" value={fiche.codeBarres} />
            <Ligne label="PPV" value={dirham(fiche.ppv)} />
            <Ligne label="PPH" value={dirham(fiche.pph)} />
            <Ligne label="TVA vente" value={pourcent(fiche.tvaVente)} />
            {/* Au-dessus du pli quand il existe : un tableau A, B ou C
                change la délivrance, ce n'est pas un détail de fiche. */}
            <Ligne label="Substance réglementée" value={tableau} />
          </>
        )}
        {/* Toujours affichés, dans les deux familles : ce sont les trois
            réponses qui changent un geste au comptoir, et « non » y est
            une information autant que « oui ». */}
        <LigneOuiNon label="Remboursable" value={fiche.remboursable} />
        {fiche.remboursable && (
          <>
            <Ligne label="Taux de remboursement" value={pourcent(fiche.tauxRemboursement)} />
            <Ligne label="Base de remboursement" value={dirham(fiche.prixBaseRemboursement)} />
          </>
        )}
        <LigneOuiNon label="Sur ordonnance" value={fiche.necessitePrescription} />
        <LigneOuiNon label="Conservation au froid" value={fiche.refrigerationRequise} />
        {/* Seulement quand la réponse est « non » : un produit retiré de la
            vente au Maroc, on veut le savoir AVANT de le mettre en rayon.
            L'afficher aussi quand tout va bien ferait une ligne « oui » sur
            chaque fiche, et c'est le « non » qui doit sauter aux yeux. */}
        {!fiche.produitCommercialise && (
          <DetailRow
            label="Commercialisé au Maroc"
            value={<span className="text-destructive">Non — produit retiré de la vente</span>}
          />
        )}
      </DetailGroup>

      {restants.length > 0 && (
        <div className="space-y-sp-sm">
          <button
            type="button"
            onClick={() => setTout((ouvert) => !ouvert)}
            aria-expanded={tout}
            className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:underline"
          >
            <ChevronDown
              className={cn("size-4 transition-transform", tout && "rotate-180")}
              aria-hidden
            />
            {tout
              ? "Masquer le reste de la fiche"
              : `Voir toute la fiche (${restants.length} champ${restants.length > 1 ? "s" : ""} de plus)`}
          </button>

          {tout && (
            <DetailGroup title="Reste de la fiche">
              {restants.map(([label, valeur, prose]) => (
                <DetailRow key={label} label={label} value={valeur} prose={prose} />
              ))}
            </DetailGroup>
          )}
        </div>
      )}
    </div>
  );
}
