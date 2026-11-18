import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, screen } from "@testing-library/react";
import { renderAvecProviders } from "@/tests/fixtures/render-avec-providers";
import { FicheRecapitulatif } from "@/components/features/stock/catalogue-entry/fiche-recapitulatif";
import type { CatalogueFiche } from "@/lib/server/stock-entry";

/**
 * L'écran d'ajout au stock dit « Vérifiez ces informations avant de les
 * ajouter à votre stock ». Ce fichier vérifie qu'il y a quelque chose à
 * vérifier.
 *
 * Le cas qui a motivé le correctif est reproduit tel quel : LOTUS BIO Huile
 * essentielle de Gingembre, 17 champs renseignés sur 43, dont **aucun** de
 * ceux qu'affichait l'ancienne carte — dosage, laboratoire, DCI et PPV sont
 * tous nuls sur une fiche de parapharmacie. Le pharmacien ajoutait le
 * produit sans jamais en voir le prix.
 */

function fiche(overrides: Partial<CatalogueFiche> = {}): CatalogueFiche {
  return {
    id: "c1",
    nom: "DOLIPRANE 500 mg",
    categorie: "PHARMACEUTIQUE",
    formeGalenique: "Comprimé",
    dosage: "500 mg",
    laboratoire: "Sanofi",
    dci: "Paracétamol",
    codeBarres: "6111234567893",
    classeTherapeutique: "Antalgiques / Antipyrétiques",
    ppv: 18.5,
    pph: 12.4,
    tvaVente: 7,
    tvaAchat: 7,
    remboursable: true,
    tauxRemboursement: 70,
    prixBaseRemboursement: 15,
    necessitePrescription: false,
    refrigerationRequise: false,
    prixVenteIndicatif: null,
    marque: null,
    categoriePrincipale: null,
    sousCategorie: null,
    sousSousCategorie: null,
    etiquettes: null,
    description: null,
    indications: null,
    excipients: null,
    posologieAdulte: null,
    posologieEnfant: null,
    contreIndicationConduite: null,
    contreIndicationAllaitement: null,
    contreIndicationGrossesse: null,
    monographie: null,
    conditionnement: null,
    gamme: null,
    sousGamme: null,
    referenceLabo: null,
    produitTableau: "AUCUN",
    produitCommercialise: true,
    groupeProduits: null,
    photos: [],
    dejaEnStock: false,
    ...overrides,
  } as unknown as CatalogueFiche;
}

/** La fiche de la capture d'écran, champ pour champ. */
const lotusBio = fiche({
  nom: "LOTUS BIO Huile essentielle de Gingembre",
  categorie: "PARAPHARMACEUTIQUE",
  formeGalenique: "Huiles essentielles",
  dosage: null,
  laboratoire: null,
  dci: null,
  codeBarres: null,
  classeTherapeutique: null,
  ppv: null,
  pph: null,
  tvaVente: null,
  tvaAchat: null,
  remboursable: false,
  tauxRemboursement: null,
  prixBaseRemboursement: null,
  prixVenteIndicatif: 75,
  categoriePrincipale: "Aromathérapie",
  sousCategorie: "Huiles essentielles",
  etiquettes: "Aromathérapie",
  description: "L'huile essentielle de gingembre est reconnue pour ses vertus tonifiantes.",
});

describe("un produit de parapharmacie", () => {
  it("montre son prix — le défaut d'origine", () => {
    renderAvecProviders(<FicheRecapitulatif fiche={lotusBio} />);
    expect(
      screen.getByText("75,00 DH"),
      "Le seul prix d'une fiche para est le prix indicatif ; l'ancienne carte " +
        "n'affichait que le PPV, réglementé et vide ici.",
    ).toBeTruthy();
  });

  it("montre son rayon, sa sous-catégorie et sa description", () => {
    renderAvecProviders(<FicheRecapitulatif fiche={lotusBio} />);
    expect(screen.getByText("Aromathérapie")).toBeTruthy();
    expect(screen.getAllByText("Huiles essentielles").length).toBeGreaterThan(0);
    expect(screen.getByText(/vertus tonifiantes/)).toBeTruthy();
  });

  it("annonce sa famille", () => {
    renderAvecProviders(<FicheRecapitulatif fiche={lotusBio} />);
    expect(screen.getByText("Parapharmaceutique")).toBeTruthy();
  });

  it("tait les champs vides de sa propre famille", () => {
    // `marque` est bien dans la section parapharmacie, et vide sur cette
    // fiche — le fichier d'import n'a pas de colonne marque. Viser un
    // libellé de l'autre famille ne prouverait rien : il n'est pas rendu
    // du tout. 26 champs sur 43 sont vides ici ; autant de tirets
    // enterreraient les 17 qui comptent.
    renderAvecProviders(<FicheRecapitulatif fiche={lotusBio} />);
    expect(screen.queryByText("Marque")).toBeNull();
  });

  it("ne rend pas non plus les champs vides du médicament", () => {
    const sansDosage = fiche({ dosage: null, pph: null });
    renderAvecProviders(<FicheRecapitulatif fiche={sansDosage} />);
    expect(screen.queryByText("Dosage")).toBeNull();
    expect(screen.queryByText("PPH")).toBeNull();
    // Les champs renseignés de la même section, eux, restent là.
    expect(screen.getByText("Paracétamol")).toBeTruthy();
  });

  it("dit quand même qu'il n'est pas remboursable", () => {
    renderAvecProviders(<FicheRecapitulatif fiche={lotusBio} />);
    // « Non » est une information, pas un vide : le pharmacien doit le
    // savoir avant de le mettre en rayon.
    expect(screen.getByText("Remboursable")).toBeTruthy();
    expect(screen.queryByText("Taux de remboursement")).toBeNull();
  });
});

describe("un médicament", () => {
  it("montre DCI, laboratoire, PPV et PPH", () => {
    renderAvecProviders(<FicheRecapitulatif fiche={fiche()} />);
    expect(screen.getByText("Paracétamol")).toBeTruthy();
    expect(screen.getByText("Sanofi")).toBeTruthy();
    expect(screen.getByText("18,50 DH")).toBeTruthy();
    expect(screen.getByText("12,40 DH")).toBeTruthy();
  });

  it("détaille le remboursement quand il s'applique", () => {
    renderAvecProviders(<FicheRecapitulatif fiche={fiche()} />);
    expect(screen.getByText("70 %")).toBeTruthy();
    expect(screen.getByText("15,00 DH")).toBeTruthy();
  });

  it("ne montre pas les champs de parapharmacie qu'il n'a pas", () => {
    renderAvecProviders(<FicheRecapitulatif fiche={fiche()} />);
    expect(screen.queryByText("Marque")).toBeNull();
    expect(screen.queryByText("Rayon")).toBeNull();
  });
});

describe("ce qu'un pharmacien doit voir avant d'ajouter", () => {
  it("signale un produit non commercialisé au Maroc", () => {
    renderAvecProviders(<FicheRecapitulatif fiche={fiche({ produitCommercialise: false })} />);
    expect(screen.getByText(/retiré de la vente/i)).toBeTruthy();
  });

  it("ne dit rien quand le produit est normalement commercialisé", () => {
    // Une ligne « oui » sur chaque fiche noierait le « non », qui est le
    // seul cas où l'information change une décision.
    renderAvecProviders(<FicheRecapitulatif fiche={fiche()} />);
    expect(screen.queryByText("Commercialisé au Maroc")).toBeNull();
  });

  it("garde la forme galénique d'un produit para, absente de son sous-titre", () => {
    renderAvecProviders(<FicheRecapitulatif fiche={lotusBio} />);
    fireEvent.click(screen.getByRole("button", { name: /Voir toute la fiche/ }));
    expect(screen.getByText("Forme galénique")).toBeTruthy();
  });
});

describe("le reste de la fiche", () => {
  it("est replié, et le bouton annonce combien de champs il cache", () => {
    renderAvecProviders(<FicheRecapitulatif fiche={lotusBio} />);
    // Étiquettes + code-barres absent + description déjà montrée… le
    // compte doit porter sur cette fiche-là, pas sur une fiche moyenne.
    const bouton = screen.getByRole("button", { name: /Voir toute la fiche \(\d+ champ/ });
    expect(bouton.getAttribute("aria-expanded")).toBe("false");
  });

  it("se déplie et montre ce qui restait caché", () => {
    renderAvecProviders(<FicheRecapitulatif fiche={lotusBio} />);
    expect(screen.queryByText("Étiquettes")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Voir toute la fiche/ }));
    expect(screen.getByText("Étiquettes")).toBeTruthy();
  });

  it("un champ renseigné n'est jamais perdu, même hors de sa famille", () => {
    // Une fiche para qui porterait tout de même un DCI : la règle des
    // fiches détail s'applique ici aussi.
    renderAvecProviders(<FicheRecapitulatif fiche={{ ...lotusBio, dci: "Zingiber officinale" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Voir toute la fiche/ }));
    expect(screen.getByText("Zingiber officinale")).toBeTruthy();
  });

  it("ne compte pas « aucun tableau » comme une information", () => {
    // La colonne vaut AUCUN par défaut, donc n'est jamais vide : sans
    // traitement, chaque médicament afficherait une ligne de bruit.
    renderAvecProviders(<FicheRecapitulatif fiche={fiche()} />);
    expect(screen.queryByText("Substance réglementée")).toBeNull();
    expect(screen.queryByText(/Tableau/)).toBeNull();
  });

  it("montre en revanche un tableau A, B ou C", () => {
    renderAvecProviders(<FicheRecapitulatif fiche={fiche({ produitTableau: "B" })} />);
    expect(screen.getByText("Tableau B")).toBeTruthy();
  });

  it("disparaît quand il n'y a rien de plus à montrer", () => {
    const minimale = fiche({
      nom: "Produit nu",
      classeTherapeutique: null,
      conditionnement: null,
      gamme: null,
      sousGamme: null,
      groupeProduits: null,
      referenceLabo: null,
    });
    renderAvecProviders(<FicheRecapitulatif fiche={minimale} />);
    expect(screen.queryByRole("button", { name: /Voir toute la fiche/ })).toBeNull();
  });
});

/**
 * Le récapitulatif promet de montrer la fiche qui sera recopiée. Une
 * colonne ajoutée au catalogue sans être ajoutée ici serait recopiée dans
 * le stock sans jamais avoir été montrée à personne — et rien ne le
 * signalerait : la page compile, le champ manque simplement. C'est
 * exactement ce qui s'est produit avec les six colonnes de la
 * parapharmacie.
 */
describe("aucune colonne du catalogue ne peut se perdre", () => {
  /** Clés, horodatages et statuts vérifiés ailleurs dans le flux. */
  const HORS_RECAPITULATIF = new Set([
    "id",
    "createdAt",
    "updatedAt",
    "dateAjout",
    // La fiche inactive est refusée à l'ajout par addCatalogueProduitToStock ;
    // l'afficher ici ne changerait aucune décision.
    "actifCatalogue",
    // Portés par le titre et la pastille, pas par une ligne du tableau.
    "nom",
    "categorie",
  ]);

  it("chaque colonne du modèle est lue par le récapitulatif", () => {
    const racine = resolve(__dirname, "../..");
    const schema = readFileSync(resolve(racine, "prisma/schema.prisma"), "utf8");
    const bloc = /^model CatalogueProduit \{([\s\S]*?)^\}/m.exec(schema);
    expect(bloc, "Modèle CatalogueProduit introuvable").toBeTruthy();

    const colonnes = bloc![1]
      .split("\n")
      .map((ligne) =>
        /^\s+(\w+)\s+(String|Decimal|Boolean|Int|DateTime|ProduitCategorie|TableauSubstance)\??/.exec(
          ligne,
        ),
      )
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => m[1]!)
      .filter((nom) => !HORS_RECAPITULATIF.has(nom));

    const source = readFileSync(
      resolve(racine, "components/features/stock/catalogue-entry/fiche-recapitulatif.tsx"),
      "utf8",
    );
    const absentes = colonnes.filter((nom) => !new RegExp(`fiche\\.${nom}\\b`).test(source));

    expect(
      absentes,
      "Colonne(s) du catalogue absente(s) du récapitulatif : elles seront " +
        "recopiées dans le stock sans que le pharmacien les ait jamais vues.",
    ).toEqual([]);
    expect(colonnes.length).toBeGreaterThan(30); // garde-fou du test lui-même
  });
});
