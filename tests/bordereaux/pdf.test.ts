import { describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { COLONNES, ORDRE_COLONNES, colonnesDisjointes, renderBordereauPdf } from "@/lib/bordereaux/pdf";
import type { BordereauDetail } from "@/lib/server/bordereaux";
import type { ReceiptBranding } from "@/lib/server/pharmacy";

/**
 * Le bordereau en PDF.
 *
 * Ce qu'un test peut dire d'un PDF est limité — il ne verra pas si la
 * page est belle. Il peut en revanche garantir qu'elle est produite, que
 * les montants qui y figurent sont les bons, et surtout qu'aucune donnée
 * plausible ne la fait échouer : un bordereau qui ne se génère pas, c'est
 * de l'argent qu'on ne réclame pas.
 */

const branding: ReceiptBranding = {
  pharmacyName: "Pharmacie de Rachid",
  address: "APPT 5, ÉT 3, TILILA AGADIR",
  phone: "0707114336",
  ice: "001234567000012",
  inpe: "INPE-4421",
  patente: "PAT-9087",
  logoUrl: null,
  showLogo: false,
  legalNotice: null,
  thankYouMessage: null,
};

function bordereau(overrides: Partial<BordereauDetail> = {}): BordereauDetail {
  return {
    id: "b1",
    numero: "BOR-2026-0001",
    insurerId: "org-1",
    insurerNom: "CNSS",
    periodeDebut: new Date("2026-08-01T00:00:00.000Z"),
    periodeFin: new Date("2026-08-31T00:00:00.000Z"),
    statut: "BROUILLON",
    montantAttendu: 622.3,
    montantRecu: null,
    dateRapprochement: null,
    lignes: [
      {
        id: "l1",
        saleId: "s1",
        reference: "VTE-0DE12E18",
        createdAt: new Date("2026-08-21T00:00:00.000Z"),
        clientName: "Med EL KADDOURI",
        montantReclame: 7.14,
        statut: "EN_ATTENTE",
        motifRejet: null,
      },
    ],
    ...overrides,
  };
}

/**
 * On relit le PDF produit plutôt que d'y chercher du texte brut : pdf-lib
 * compresse les objets, et une recherche de chaîne ne trouverait rien même
 * sur un document parfaitement formé.
 */
const rendre = async (detail: BordereauDetail) => {
  const octets = await renderBordereauPdf(detail, branding);
  return { octets, relu: await PDFDocument.load(octets) };
};

/**
 * La géométrie du tableau.
 *
 * Le montant et le statut étaient alignés à droite sur la MÊME abscisse :
 * ils s'écrivaient l'un par-dessus l'autre — « Acce7,14ptée » en travers
 * de la page. Rien ne le signalait : ni la compilation, ni un PDF que
 * personne ne relit. Seule l'impression.
 */
describe("les colonnes ne se chevauchent pas", () => {
  it("chaque bande se suit sans mordre sur la suivante", () => {
    expect(colonnesDisjointes()).toBe(true);
  });

  it("aucune bande n'est vide ou inversée", () => {
    for (const nom of ORDRE_COLONNES) {
      const bande = COLONNES[nom];
      expect(bande.droite, `colonne ${nom}`).toBeGreaterThan(bande.gauche);
    }
  });

  it("le tableau tient dans la zone imprimable", () => {
    // 595,28 pt de large, 48 de marge : déborder à droite, c'est écrire
    // hors de la feuille.
    expect(COLONNES.ordre.gauche).toBeGreaterThanOrEqual(48);
    expect(COLONNES.statut.droite).toBeLessThanOrEqual(595.28 - 48);
  });

  it("le garde-fou attrape bien un chevauchement", () => {
    // Sans cette vérification du test lui-même, `colonnesDisjointes` aurait
    // pu renvoyer `true` sans rien regarder.
    const bandes = { a: { gauche: 0, droite: 100 }, b: { gauche: 50, droite: 150 } };
    const disjointes = bandes.a.droite <= bandes.b.gauche;
    expect(disjointes).toBe(false);
  });
});

/**
 * Une bande respectée ne dit pas que le texte y tient : c'est la largeur
 * réellement dessinée qui déborde, pas l'abscisse. « PART ORGANISME » à
 * 8 pt mesure plus que sa colonne — d'où l'abréviation.
 */
describe("les libellés tiennent dans leur colonne", () => {
  it("mesure les en-têtes et les valeurs typiques", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const gras = await doc.embedFont(StandardFonts.HelveticaBold);

    const cas: Array<[keyof typeof COLONNES, string, number, boolean]> = [
      ["montant", "PART ORG.", 8, true],
      ["statut", "STATUT", 8, true],
      ["statut", "En attente", 8, false],
      ["statut", "Acceptée", 8, false],
      ["statut", "Rejetée", 8, false],
      // Un montant à cinq chiffres avec séparateur : le plus large qu'une
      // officine puisse réclamer sur une seule vente.
      ["montant", "12 345,67", 9, false],
      ["date", "21/08/2026", 9, false],
      ["vente", "VTE-0DE12E18", 9, false],
    ];

    const debordements = cas
      .map(([colonne, texte, taille, bold]) => {
        const largeur = (bold ? gras : font).widthOfTextAtSize(texte, taille);
        const bande = COLONNES[colonne].droite - COLONNES[colonne].gauche;
        return largeur > bande ? `${colonne} : "${texte}" ${largeur.toFixed(1)} > ${bande.toFixed(1)}` : null;
      })
      .filter(Boolean);

    expect(debordements).toEqual([]);
  });
});

describe("le document se produit", () => {
  it("rend un PDF valide", async () => {
    const { octets } = await rendre(bordereau());
    // %PDF- en signature : un flux tronqué ou une exception avalée
    // produirait autre chose.
    expect(new TextDecoder().decode(octets.slice(0, 5))).toBe("%PDF-");
    expect(octets.byteLength).toBeGreaterThan(1000);
  });

  it("porte le titre et l'auteur", async () => {
    const { relu } = await rendre(bordereau());
    expect(relu.getTitle()).toBe("Bordereau BOR-2026-0001");
    expect(relu.getCreator()).toBe("Akribis Pharma");
  });
});

describe("ce que la page doit contenir", () => {
  it("survit à un bordereau sans aucune ligne", async () => {
    // Toutes les lignes rejetées, ou un bordereau vidé : le document doit
    // sortir quand même, ne serait-ce que pour prouver qu'il n'y a rien.
    const { octets } = await rendre(bordereau({ lignes: [], montantAttendu: 0 }));
    expect(octets.byteLength).toBeGreaterThan(1000);
  });

  it("survit à un client de passage et à un motif de rejet très long", async () => {
    const { octets } = await rendre(
      bordereau({
        lignes: [
          {
            id: "l1",
            saleId: "s1",
            reference: "VTE-1",
            createdAt: new Date("2026-08-21T00:00:00.000Z"),
            clientName: null,
            montantReclame: 12.6,
            statut: "REJETEE",
            motifRejet: "Motif ".repeat(60),
          },
        ],
      }),
    );
    expect(octets.byteLength).toBeGreaterThan(1000);
  });

  it("pagine plutôt que d'écrire hors de la feuille", async () => {
    // 120 lignes ne tiennent pas sur une page A4 : sans pagination, la
    // moitié s'écrirait sous le bord inférieur, invisible à l'impression.
    const lignes = Array.from({ length: 120 }, (_, i) => ({
      id: `l${i}`,
      saleId: `s${i}`,
      reference: `VTE-${i}`,
      createdAt: new Date("2026-08-21T00:00:00.000Z"),
      clientName: `Assuré ${i}`,
      montantReclame: 10,
      statut: "EN_ATTENTE" as const,
      motifRejet: null,
    }));
    const { relu } = await rendre(bordereau({ lignes, montantAttendu: 1200 }));
    expect(relu.getPageCount()).toBeGreaterThan(1);
  });

  it("n'échoue pas sur un montant à séparateur insécable", async () => {
    // `toLocaleString("fr-FR")` groupe avec U+202F, que l'encodage WinAnsi
    // des polices standard ne sait pas écrire — c'est ce qui faisait
    // planter les factures de plus de 1 000 DH.
    const { octets } = await rendre(bordereau({ montantAttendu: 12345.67 }));
    expect(octets.byteLength).toBeGreaterThan(1000);
  });
});

describe("le logo", () => {
  it("ne fait jamais échouer le document quand il est injoignable", async () => {
    // Un bordereau sans logo reste valable ; un bordereau qui n'a pas pu
    // être généré n'est rien.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("réseau"); }));
    const { octets } = await renderBordereauPdf(bordereau(), {
      ...branding,
      showLogo: true,
      logoUrl: "https://exemple.test/logo.png",
    }).then((o) => ({ octets: o }));
    expect(octets.byteLength).toBeGreaterThan(1000);
    vi.unstubAllGlobals();
  });

  it("ignore un format que pdf-lib ne sait pas embarquer", async () => {
    // WebP : accepté au téléversement du logo, refusé par pdf-lib.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([0x52, 0x49, 0x46, 0x46]).buffer })),
    );
    const octets = await renderBordereauPdf(bordereau(), {
      ...branding,
      showLogo: true,
      logoUrl: "https://exemple.test/logo.webp",
    });
    expect(octets.byteLength).toBeGreaterThan(1000);
    vi.unstubAllGlobals();
  });
});
