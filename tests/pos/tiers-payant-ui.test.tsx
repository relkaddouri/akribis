import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { screen, within } from "@testing-library/react";
import { renderAvecProviders } from "@/tests/fixtures/render-avec-providers";
import { CartLines, CheckoutPanel } from "@/components/features/pos/cart-panel";
import { SalesView } from "@/components/features/sales/sales-view";
import { StatutCreanceBadge } from "@/components/features/sales/statut-creance-badge";
import { SaleDetailView } from "@/components/features/sales/sale-detail-view";
import type { CartLine } from "@/lib/pos/cart";
import type { OrganismeRecord } from "@/lib/server/organismes";
import type { SaleListItem } from "@/lib/server/sales-returns";

/**
 * Ce que le comptoir montre d'une vente en tiers payant, et ce que la page
 * Ventes en retient ensuite.
 */

const listSalesMock = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
vi.mock("@/lib/server/sales-returns", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listSales: listSalesMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/ventes",
  useSearchParams: () => new URLSearchParams(),
}));

function ligne(overrides: Partial<CartLine> = {}): CartLine {
  return {
    productId: "p1",
    productName: "DOLIPRANE 500 mg",
    unitPrice: 18.5,
    quantity: 1,
    availableStock: 50,
    remboursable: true,
    baseRemboursement: 15,
    ...overrides,
  };
}

const CNSS: OrganismeRecord = {
  id: "org-1",
  nom: "CNSS/AMO",
  code: "CNSS",
  tauxCouverture: 70,
  formatBordereau: null,
  actif: true,
};

function rendrePanier(options: {
  lines?: CartLine[];
  organismes?: OrganismeRecord[];
  insurerId?: string | null;
  onChangeInsurer?: (id: string | null) => void;
} = {}) {
  return renderAvecProviders(
    <CheckoutPanel
      lines={options.lines ?? [ligne()]}
      paymentMethod="CASH"
      onChangePaymentMethod={() => {}}
      cashReceived={0}
      onChangeCashReceived={() => {}}
      onValidate={() => {}}
      isSubmitting={false}
      canValidate
      client={null}
      organismes={options.organismes ?? [CNSS]}
      insurerId={options.insurerId ?? null}
      onChangeInsurer={options.onChangeInsurer ?? (() => {})}
    />,
  );
}

/**
 * L'ouverture du Select et le choix d'une option ne sont pas couverts :
 * piloter un Select Radix sous jsdom teste surtout Radix. Ce qui compte —
 * la décision que ce choix déclenche — l'est par lib/pos/tiers-payant.ts,
 * et l'apparition du sélecteur par les cas ci-dessous.
 */
describe("le sélecteur d'organisme", () => {
  it("apparaît dès qu'une ligne est remboursable", () => {
    rendrePanier();
    expect(screen.getByLabelText("Tiers payant")).toBeTruthy();
  });

  it("reste caché sur un panier sans remboursable", () => {
    // Le proposer sur de la parapharmacie promettrait une prise en charge
    // que le calcul refuserait ensuite.
    rendrePanier({ lines: [ligne({ remboursable: false, baseRemboursement: null })] });
    expect(screen.queryByLabelText("Tiers payant")).toBeNull();
  });

  it("reste caché quand l'officine n'est conventionnée avec personne", () => {
    rendrePanier({ organismes: [] });
    expect(screen.queryByLabelText("Tiers payant")).toBeNull();
  });

  it("reste caché sur un remboursable dont la base n'est pas saisie", () => {
    rendrePanier({ lines: [ligne({ baseRemboursement: null })] });
    expect(screen.queryByLabelText("Tiers payant")).toBeNull();
  });
});

describe("la ligne de panier", () => {
  const rendreLignes = (
    lignes = [ligne()],
    taux: number | null = 70,
    nom: string | null = "CNSS",
  ) =>
    renderAvecProviders(
      <CartLines
        lines={lignes}
        onChangeLines={() => {}}
        tauxCouverture={taux}
        insurerNom={nom}
      />,
    );

  it("dit la base et ce qu'elle rapporte", () => {
    // Le client demande au comptoir pourquoi il paie 4,61 et non 3,52 :
    // sans la base à l'écran, le pharmacien n'a rien à répondre.
    rendreLignes();
    expect(screen.getByText(/base 15,00 → CNSS 10,50/)).toBeTruthy();
  });

  it("ne dit rien quand aucun organisme n'est retenu", () => {
    rendreLignes([ligne()], null, null);
    expect(screen.queryByText(/base 15,00/)).toBeNull();
  });

  it("ne dit rien sur une ligne non remboursable", () => {
    rendreLignes([ligne({ remboursable: false, baseRemboursement: null })]);
    expect(screen.queryByText(/base/)).toBeNull();
  });

  it("garde le prix unitaire et la quantité", () => {
    rendreLignes();
    expect(screen.getByText(/18,50 × 1/)).toBeTruthy();
  });
});

describe("les deux montants au paiement", () => {
  it("n'affiche qu'un total quand personne ne prend en charge", () => {
    rendrePanier();
    expect(screen.getByText("Total")).toBeTruthy();
    expect(screen.queryByText("À encaisser")).toBeNull();
  });

  it("sépare la part client de la part organisme", () => {
    rendrePanier({ insurerId: "org-1" });
    // 15 DH de base à 70 % = 10,50 ; reste 8,00 pour le client.
    expect(screen.getByText("À encaisser")).toBeTruthy();
    expect(screen.getByText(/8,00/)).toBeTruthy();
    expect(screen.getByText(/−10,50/)).toBeTruthy();
    expect(screen.getByText(/Part CNSS\/AMO/)).toBeTruthy();
    // Le total apparaît aussi sur la ligne du produit : on vise celui du
    // récapitulatif, à côté de son libellé.
    const recapitulatif = screen.getByText("Total de la vente").closest("div")!;
    expect(within(recapitulatif).getByText(/18,50/)).toBeTruthy();
  });

  it("ne montre pas de ligne « part organisme » à zéro", () => {
    // Un organisme choisi mais rien de remboursable dans ce qu'il couvre.
    rendrePanier({
      lines: [ligne({ baseRemboursement: null })],
      insurerId: "org-1",
    });
    expect(screen.queryByText("À encaisser")).toBeNull();
  });
});

describe("la fiche d'une vente", () => {
  const detail = {
    id: "s1",
    reference: "VTE-0DE12E18",
    createdAt: new Date("2026-08-21T20:47:02.000Z"),
    clientName: "Med EL KADDOURI",
    clientPhone: null,
    totalAmount: 11.75,
    montantPartClient: 4.61,
    montantPartAssurance: 7.14,
    statutCreance: "EN_ATTENTE_BORDEREAU" as const,
    insurerNom: "CNSS",
    paymentMethod: "CASH" as const,
    returnStatus: "none" as const,
    invoiced: false,
    invoiceNumber: null,
    lines: [
      {
        saleItemId: "l1",
        productId: "p1",
        productName: "DOLIPRANE",
        quantity: 1,
        returnedQuantity: 0,
        unitPrice: 11.75,
        lineTotal: 11.75,
        remboursable: true,
        baseRemboursement: 10.2,
        montantPartAssurance: 7.14,
      },
    ],
    returns: [],
  };

  it("montre l'organisme, le statut et les deux montants", () => {
    renderAvecProviders(<SaleDetailView sale={detail} />);
    expect(screen.getByText("Tiers payant")).toBeTruthy();
    expect(screen.getByText("CNSS")).toBeTruthy();
    expect(screen.getByText("À mettre en bordereau")).toBeTruthy();
    // La fiche restait muette : la liste annonçait la créance, l'écran où
    // l'on vient chercher combien réclamer n'en disait rien.
    expect(screen.getByText(/4,61/)).toBeTruthy();
    // Deux fois 7,14 : sur la ligne du produit et dans la carte. Les deux
    // sont voulus — le total doit se rapprocher ligne à ligne.
    expect(screen.getAllByText(/7,14/)).toHaveLength(2);
  });

  it("dit ce que chaque ligne réclame, depuis l'instantané figé", () => {
    // Recalculer à l'affichage donnerait la base et le taux d'aujourd'hui,
    // pas ceux du jour de la vente.
    renderAvecProviders(<SaleDetailView sale={detail} />);
    const ligneProduit = screen.getByText("DOLIPRANE").closest("td")!;
    expect(within(ligneProduit).getByText(/base 10\.20 → 7,14/)).toBeTruthy();
  });

  it("se tait sur une vente d'avant l'instantané", () => {
    const ancienne = {
      ...detail,
      lines: [{ ...detail.lines[0]!, montantPartAssurance: 0 }],
    };
    renderAvecProviders(<SaleDetailView sale={ancienne} />);
    const ligneProduit = screen.getByText("DOLIPRANE").closest("td")!;
    expect(within(ligneProduit).queryByText(/→/)).toBeNull();
  });

  it("ne montre aucune carte sur une vente sans tiers payant", () => {
    const ordinaire = {
      ...detail,
      statutCreance: "AUCUNE" as const,
      montantPartAssurance: 0,
      montantPartClient: 11.75,
      insurerNom: null,
    };
    renderAvecProviders(<SaleDetailView sale={ordinaire} />);
    expect(screen.queryByText("Tiers payant")).toBeNull();
  });
});

/**
 * Les composants reçoivent leurs montants en props : un test de rendu ne
 * dit donc rien de la façade qui les remplit. Un champ oublié dans le
 * `map` de `getSale` afficherait 0,00 DH sans qu'aucune assertion ne
 * bronche — et 0,00 se lit comme un montant.
 */
describe("la façade lit bien les montants du tiers payant", () => {
  it("les trois champs sont recopiés depuis la ligne", () => {
    const src = readFileSync(
      resolve(__dirname, "../..", "lib/server/sales-returns.ts"),
      "utf8",
    );
    for (const champ of [
      "montantPartClient: Number(sale.montantPartClient)",
      "montantPartAssurance: Number(sale.montantPartAssurance)",
      "insurerNom: sale.insurer?.nom ?? null",
    ]) {
      expect(src, `${champ} absent de la façade`).toContain(champ);
    }
  });
});

describe("la pastille de créance, prise isolément", () => {
  it("ne rend rien pour une vente sans tiers payant", () => {
    // La colonne écarte déjà ce cas, mais la pastille est exportée : elle
    // doit se taire d'elle-même là où on la posera ensuite.
    const { container } = renderAvecProviders(<StatutCreanceBadge statut="AUCUNE" />);
    expect(container.textContent).toBe("");
  });

  it("nomme chaque état en clair", () => {
    const { container } = renderAvecProviders(
      <StatutCreanceBadge statut="EN_ATTENTE_BORDEREAU" />,
    );
    expect(container.textContent).toBe("À mettre en bordereau");
  });
});

describe("la page Ventes", () => {
  function vente(overrides: Partial<SaleListItem> = {}): SaleListItem {
    return {
      id: "s1",
      reference: "VTE-1A2B3C4D",
      createdAt: new Date("2026-08-21T10:00:00.000Z"),
      clientName: "Amina B.",
      totalAmount: 18.5,
      paymentMethod: "CASH",
      returnStatus: "none",
      invoiced: false,
      statutCreance: "EN_ATTENTE_BORDEREAU",
      montantPartAssurance: 10.5,
      insurerNom: "CNSS/AMO",
      ...overrides,
    };
  }

  // SalesView charge ses ventes elle-même : c'est la façade qu'on remplace.
  const rendre = async (sales: SaleListItem[]) => {
    listSalesMock.mockResolvedValue(sales);
    renderAvecProviders(<SalesView />);
    return screen.findByText(sales[0]!.reference);
  };

  it("signale une créance à traiter, avec son organisme et son montant", async () => {
    const ligneVente = (await rendre([vente()])).closest("tr")!;
    expect(within(ligneVente).getByText("À mettre en bordereau")).toBeTruthy();
    expect(within(ligneVente).getByText(/CNSS\/AMO/)).toBeTruthy();
  });

  it("laisse une vente ordinaire discrète", async () => {
    // Une pastille « aucune créance » sur chaque ligne ferait du bruit là
    // où la colonne sert justement à repérer l'exception.
    const ligneVente = (
      await rendre([vente({ statutCreance: "AUCUNE", montantPartAssurance: 0, insurerNom: null })])
    ).closest("tr")!;
    expect(within(ligneVente).queryByText("Aucune créance")).toBeNull();
    expect(within(ligneVente).getByText("—")).toBeTruthy();
  });

  it("propose le filtre par statut de créance", async () => {
    await rendre([vente()]);
    expect(screen.getByText("Statut créance : tous")).toBeTruthy();
  });
});

/**
 * Le champ client se fondait dans le fond : `bg-muted/60` sans bordure, sur
 * une page grise. Il existait, mais rien ne le signalait — et sans
 * intitulé il se lisait comme une seconde barre de recherche produit.
 */
describe("le choix du client se voit", () => {
  it("porte l'habillage d'une carte, pas un aplat gris", () => {
    const src = readFileSync(
      resolve(__dirname, "../..", "components/features/pos/client-picker.tsx"),
      "utf8",
    );
    expect(src).not.toContain("bg-muted/60");
    expect(src).toContain("bg-card");
  });

  it("le comptoir occupe toute la largeur", () => {
    // Deux colonnes centrées sous un plafond laissaient des marges vides
    // de part et d'autre sur un écran de caisse.
    const src = readFileSync(
      resolve(__dirname, "../..", "components/features/pos/pos-view.tsx"),
      "utf8",
    );
    const grille = /<div className="grid w-full[^"]*"/.exec(src);
    expect(grille, "grille du comptoir introuvable").toBeTruthy();
    expect(grille![0]).not.toMatch(/max-w-/);
    expect(grille![0]).not.toMatch(/mx-auto/);
  });
});

/**
 * Le mode caisse : le vrai plein écran du navigateur.
 *
 * `requestFullscreen()` est le seul moyen de faire disparaître les onglets
 * et la barre d'adresse — une surcouche CSS recouvre l'application, jamais
 * le navigateur. jsdom ne l'implémente pas, d'où la lecture du source :
 * ces tests protègent les décisions, pas le rendu.
 */
describe("le plein écran de la caisse", () => {
  const src = () =>
    readFileSync(resolve(__dirname, "../..", "components/features/pos/pos-view.tsx"), "utf8");

  it("demande le plein écran au navigateur", () => {
    // Une surcouche seule laisserait les onglets et l'URL à l'écran.
    expect(src()).toMatch(/requestFullscreen\(\)/);
    expect(src()).toMatch(/exitFullscreen\(\)/);
  });

  it("ne creuse pas de bande vide au-dessus de l'en-tête", () => {
    // La disposition normale ne met aucun rembourrage en haut : l'en-tête
    // colle au bord du port de défilement. Un `p-sp-lg` uniforme sur la
    // surcouche laissait 24 px vides au sommet — invisibles en fenêtre,
    // évidents en plein écran où le haut de l'écran est le haut de la page.
    const classes = /pleinEcran && "([^"]+)"/.exec(src());
    expect(classes, "classes du plein écran introuvables").toBeTruthy();
    expect(classes![1]).not.toMatch(/(^| )p-sp-/);
    expect(classes![1]).toContain("pb-sp-lg");
  });

  it("recouvre aussi la barre latérale de l'application", () => {
    // Sans la surcouche, le plein écran afficherait la barre latérale et
    // l'en-tête en grand plutôt que la caisse seule.
    expect(src()).toMatch(/pleinEcran &&/);
    expect(src()).toContain("fixed inset-0 z-50");
  });

  it("suit le navigateur plutôt que de tenir son propre état", () => {
    // On sort du plein écran par F11 ou par le menu du navigateur sans
    // passer par le bouton : la surcouche resterait alors affichée en
    // fenêtre normale, sans plus rien pour la fermer.
    expect(src()).toMatch(/addEventListener\("fullscreenchange"/);
    expect(src()).toMatch(/document\.fullscreenElement/);
  });

  it("sort du plein écran avec Échap, sans vider le panier", () => {
    const source = src();
    const echap = /if \(event\.key === "Escape"\)[\s\S]*?\n    \}/.exec(source);
    expect(echap, "branche Échap introuvable").toBeTruthy();
    // L'ordre compte : la sortie du plein écran doit précéder — et
    // court-circuiter — le vidage du panier.
    expect(echap![0].indexOf("basculerPleinEcran")).toBeLessThan(
      echap![0].indexOf("clearCart"),
    );
    expect(echap![0]).toMatch(/if \(pleinEcran\)[\s\S]*?return;/);
  });

  it("ne bascule pas la surcouche si le navigateur refuse", () => {
    // Politique d'appareil, iframe sans autorisation : la surcouche
    // masquerait la navigation sans rien apporter, et sans issue visible.
    const bascule = /async function basculerPleinEcran[\s\S]*?\n  \}/.exec(src());
    expect(bascule).toBeTruthy();
    expect(bascule![0]).not.toMatch(/setPleinEcran/);
  });

  it("offre un aller-retour, pas un aller simple", () => {
    expect(src()).toContain("Quitter le plein écran");
    expect(src()).toContain("Plein écran");
  });
});

/**
 * Le tiers payant proposé d'après la fiche client.
 *
 * Vérifié sur la source, faute de mieux : `PosView` monte la couche hors
 * ligne (Dexie, file de synchronisation) dès l'import, et aucun test du
 * dépôt ne la rend. Ce que ces assertions verrouillent, c'est la forme du
 * mécanisme — proposé à la sélection, et non réappliqué en boucle — parce
 * que c'est justement la version en effet qui paraît la plus naturelle à
 * écrire et qui écraserait le choix du pharmacien à chaque rendu.
 */
describe("l'organisme du client pré-remplit le tiers payant", () => {
  const source = readFileSync(
    resolve(__dirname, "../..", "components/features/pos/pos-view.tsx"),
    "utf8",
  );
  const choisirClient = /const choisirClient = useCallback\([\s\S]*?\n  \}, \[\]\);/.exec(source);

  it("existe, et s'applique au moment du choix", () => {
    expect(choisirClient, "choisirClient introuvable").toBeTruthy();
    expect(choisirClient![0]).toMatch(/setInsurerId\(choisi\?\.insurerId \?\? null\)/);
    expect(source).toMatch(/onChange=\{choisirClient\}/);
  });

  it("ne passe pas par un effet, qui écraserait un choix manuel", () => {
    expect(source).not.toMatch(/useEffect\([^)]*\)[\s\S]{0,200}setInsurerId\(client/);
  });

  it("laisse le sélecteur modifiable pour la vente en cours", () => {
    // `onChangeInsurer` reste branché sur le `setInsurerId` brut : le
    // pré-remplissage est une proposition, pas un verrou.
    expect(source).toMatch(/onChangeInsurer=\{setInsurerId\}/);
  });

  it("remet le sélecteur à zéro quand le client est retiré", () => {
    // L'organisme retenu était le sien ; le laisser en place réclamerait
    // pour un assuré qui n'est plus sur la vente.
    expect(choisirClient![0]).toContain("?? null");
  });

  it("ouvre le sélecteur sur F4, sans casser quand il n'est pas affiché", () => {
    // Le champ n'existe que si le panier contient de quoi rembourser.
    expect(source).toMatch(/event\.key === "F4"/);
    expect(source).toMatch(/getElementById\("organisme-vente"\)/);
    expect(source).toMatch(/if \(selecteur\) \{/);
  });
});
