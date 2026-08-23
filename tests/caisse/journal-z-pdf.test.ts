import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { renderJournalZPdf } from "@/lib/caisse/journal-z-pdf";
import type { JournalZ } from "@/lib/server/caisse";
import type { ReceiptBranding } from "@/lib/server/pharmacy";

/**
 * Le Journal Z imprimé.
 *
 * C'est la pièce comptable de la journée : on l'imprime le soir et on la
 * classe. Elle doit donc se lire **seule**, sans l'application — d'où les
 * vérifications sur ce qu'elle contient vraiment, relu depuis les octets
 * du PDF et non depuis les données qu'on lui a passées.
 */

function branding(): ReceiptBranding {
  return {
    pharmacyName: "Pharmacie de Rachid",
    address: "APPT 5, TILILA AGADIR",
    phone: "0707114336",
    ice: "001234567000012",
    inpe: null,
    patente: null,
    logoUrl: null,
    showLogo: false,
    legalNotice: null,
    thankYouMessage: null,
  } as ReceiptBranding;
}

function journal(surcharges: Partial<JournalZ> = {}): JournalZ {
  return {
    session: {
      id: "sess-1",
      statut: "cloturee",
      fondCaisseInitial: 300,
      dateOuverture: new Date(2026, 7, 23, 8, 12),
      ouvertePar: "u1",
      ouvreurNom: "Salma",
      fermeePar: "u2",
      fermeurNom: "Rachid",
      dateFermeture: new Date(2026, 7, 23, 20, 5),
      especesTheoriques: 756.4,
      especesReelles: 736.4,
      ecartCaisse: -20,
      numeroZ: "Z-2026-08-23-001",
      fermetureParPin: false,
      nombreVentes: 12,
    },
    pharmacyName: "Pharmacie de Rachid",
    identifiantFiscal: "237878237823",
    ice: "001234567000012",
    totaux: { caBrut: 1456.4, retours: 30, caNet: 1426.4, nombreVentes: 12 },
    paiements: { CASH: 456.4, CARD: 720, CREDIT: 250, tiersPayant: 180 },
    tva: [
      { taux: 0, baseHt: 300, tva: 0 },
      { taux: 7, baseHt: 500, tva: 35 },
      { taux: 20, baseHt: 520, tva: 104 },
    ],
    rattrapagesOffline: 0,
    ...surcharges,
  };
}

/**
 * Le texte du PDF, décompressé et décodé.
 *
 * Deux pièges, et il faut les deux pour lire quoi que ce soit. pdf-lib
 * comprime les flux de contenu en Flate — chercher un mot dans les octets
 * rendus ne trouve jamais rien. Et il écrit le texte en chaînes
 * **hexadécimales** (`<4A4F55...> Tj`), pas en littéraux entre
 * parenthèses : une extraction qui ne cherche que les parenthèses rend une
 * chaîne vide, et tous les tests passent au rouge d'un coup pour une
 * raison qui n'a rien à voir avec le document.
 *
 * Le décodage se fait en latin1 : les polices standard de pdf-lib sont en
 * WinAnsi, qui coïncide avec latin1 sur toute la plage utile ici.
 */
function texteDuPdf(pdf: Uint8Array): string {
  const brut = Buffer.from(pdf);
  const morceaux: string[] = [];
  let position = 0;

  for (;;) {
    const debut = brut.indexOf("stream", position);
    if (debut === -1) break;
    const fin = brut.indexOf("endstream", debut);
    if (fin === -1) break;
    let depart = debut + "stream".length;
    if (brut[depart] === 0x0d) depart += 1;
    if (brut[depart] === 0x0a) depart += 1;
    try {
      const flux = inflateSync(brut.subarray(depart, fin)).toString("latin1");
      for (const trouve of flux.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
        morceaux.push(Buffer.from(trouve[1]!, "hex").toString("latin1"));
      }
    } catch {
      // Flux non compressé ou non déchiffrable : sans intérêt ici.
    }
    position = fin + "endstream".length;
  }
  // Espaces Unicode ramenées à l'espace ordinaire : le séparateur de
  // milliers français est U+202F, que `toWinAnsi` convertit déjà, mais une
  // assertion écrite avec une espace normale ne doit dépendre de rien.
  return morceaux.join("\n").replace(/[\u00a0\u202f]/g, " ");
}

/**
 * Le texte du PDF **avec la couleur de son encre**.
 *
 * Indispensable ici, et absent de la première version de ce fichier : un
 * écart de −500 imprimé en vert se lirait comme un compte juste, et une
 * extraction qui ne voit que les caractères laisse passer exactement cette
 * faute. pdf-lib pose la couleur par un opérateur `r g b rg` avant le
 * texte ; on suit donc la dernière couleur en vigueur à chaque `Tj`.
 */
function encresDuPdf(
  pdf: Uint8Array,
): Array<{ texte: string; rouge: number; vert: number; bleu: number }> {
  const brut = Buffer.from(pdf);
  const sorties: Array<{ texte: string; rouge: number; vert: number; bleu: number }> = [];
  let position = 0;

  for (;;) {
    const debut = brut.indexOf("stream", position);
    if (debut === -1) break;
    const fin = brut.indexOf("endstream", debut);
    if (fin === -1) break;
    let depart = debut + "stream".length;
    if (brut[depart] === 0x0d) depart += 1;
    if (brut[depart] === 0x0a) depart += 1;

    try {
      const flux = inflateSync(brut.subarray(depart, fin)).toString("latin1");
      let rouge = 0;
      let vert = 0;
      let bleu = 0;
      const motif = /([\d.]+) ([\d.]+) ([\d.]+) rg|<([0-9A-Fa-f]+)>\s*Tj/g;
      for (const trouve of flux.matchAll(motif)) {
        if (trouve[4] !== undefined) {
          sorties.push({
            texte: Buffer.from(trouve[4], "hex").toString("latin1").replace(/[\u00a0\u202f]/g, " "),
            rouge,
            vert,
            bleu,
          });
        } else {
          rouge = Number(trouve[1]);
          vert = Number(trouve[2]);
          bleu = Number(trouve[3]);
        }
      }
    } catch {
      // Flux non compressé ou non déchiffrable : sans intérêt ici.
    }
    position = fin + "endstream".length;
  }
  return sorties;
}

describe("la couleur de l'écart", () => {
  function encreDe(texte: string, pdf: Uint8Array) {
    const trouve = encresDuPdf(pdf).find((e) => e.texte === texte);
    expect(trouve, `« ${texte} » absent du document`).toBeTruthy();
    return trouve!;
  }

  it("imprime un manque en rouge", async () => {
    // Le seul cas où le pharmacien doit s'arrêter sur le chiffre.
    const encre = encreDe("-20,00 MAD", await renderJournalZPdf(journal(), branding()));
    expect(encre.rouge).toBeGreaterThan(0.5);
    expect(encre.vert).toBeLessThan(0.3);
  });

  it("n'imprime pas un excédent en rouge", async () => {
    // Un excédent est une anomalie à expliquer, pas une perte : le rouge
    // le ferait lire comme un vol.
    const z = journal();
    const encre = encreDe(
      "+15,00 MAD",
      await renderJournalZPdf(
        { ...z, session: { ...z.session, ecartCaisse: 15, especesReelles: 771.4 } },
        branding(),
      ),
    );
    /*
     * Le test porte sur le **vert**, et non sur le rouge : l'ambre
     * (0,68 / 0,44 / 0,05) et le rouge (0,72 / 0,11 / 0,11) ont presque la
     * même composante rouge, et un seuil posé là laissait passer un
     * excédent imprimé en rouge. C'est le vert qui les sépare.
     */
    expect(encre.vert, "excédent imprimé en rouge").toBeGreaterThan(0.3);
  });

  it("imprime un compte juste en vert", async () => {
    const z = journal();
    const encre = encreDe(
      "Le compte y est",
      await renderJournalZPdf(
        { ...z, session: { ...z.session, ecartCaisse: 0, especesReelles: 756.4 } },
        branding(),
      ),
    );
    expect(encre.vert).toBeGreaterThan(encre.rouge);
  });

  it("écrit l'écart en encre visible, jamais en blanc sur blanc", async () => {
    /*
     * Une couleur mal posée laisse le texte **dans le flux** — invisible
     * au lecteur, mais bien présent pour un test qui ne lirait que les
     * caractères. C'est exactement la mutation qui survivait avant que ce
     * fichier ne sache lire l'encre.
     */
    const encre = encreDe("-20,00 MAD", await renderJournalZPdf(journal(), branding()));
    const clarte = (encre.rouge + encre.vert + encre.bleu) / 3;
    expect(clarte, "montant écrit en blanc sur fond clair").toBeLessThan(0.8);
  });
});

describe("le Journal Z imprimé", () => {
  it("porte de quoi être identifié sans l'application", async () => {
    const texte = texteDuPdf(await renderJournalZPdf(journal(), branding()));

    expect(texte).toContain("JOURNAL Z");
    expect(texte).toContain("Z-2026-08-23-001");
    expect(texte).toContain("Pharmacie de Rachid");
    // L'IF et l'ICE : une pièce comptable sans identifiant fiscal ne vaut
    // rien devant un contrôle.
    expect(texte).toContain("IF : 237878237823");
    expect(texte).toContain("ICE : 001234567000012");
  });

  it("nomme qui a ouvert et qui a fermé", async () => {
    const texte = texteDuPdf(await renderJournalZPdf(journal(), branding()));
    expect(texte).toContain("Salma");
    expect(texte).toContain("Rachid");
  });

  it("mentionne une clôture faite au code PIN", async () => {
    // Des mois plus tard, c'est la seule façon de savoir qu'un assistant a
    // arrêté la caisse à la place du titulaire.
    const z = journal();
    const texte = texteDuPdf(
      await renderJournalZPdf(
        { ...z, session: { ...z.session, fermetureParPin: true } },
        branding(),
      ),
    );
    expect(texte).toContain("Rachid (code PIN)");
  });

  it("imprime l'écart, les trois montants qui le composent", async () => {
    const texte = texteDuPdf(await renderJournalZPdf(journal(), branding()));

    expect(texte).toContain("300,00 MAD"); // fond initial
    expect(texte).toContain("756,40 MAD"); // théorique
    expect(texte).toContain("736,40 MAD"); // compté
    // Les deux en **lignes entières** : le cartouche porte son titre, et le
    // montant se tient seul dessous en grand. Chercher « ÉCART » en
    // sous-chaîne resterait vert si l'un des deux disparaissait, puisque
    // le titre contient déjà le mot.
    const lignes = texte.split("\n");
    expect(lignes).toContain("ÉCART DE CAISSE");
    expect(lignes).toContain("-20,00 MAD");
  });

  it("détaille le CA et les modes de règlement", async () => {
    const texte = texteDuPdf(await renderJournalZPdf(journal(), branding()));

    expect(texte).toContain("1 456,40 MAD");
    expect(texte).toContain("1 426,40 MAD");
    expect(texte).toContain("456,40 MAD"); // espèces
    expect(texte).toContain("720,00 MAD"); // carte
    // La part organisme est nommée pour ce qu'elle est : une créance, pas
    // un encaissement.
    expect(texte).toContain("Part organisme (à réclamer)");
  });

  it("n'invente pas de mode de règlement inexistant", async () => {
    // Le chèque n'existe pas dans cette application : une ligne à 0,00
    // ferait chercher où sont passés les chèques.
    const texte = texteDuPdf(await renderJournalZPdf(journal(), branding()));
    expect(texte).not.toMatch(/ch[èe]que/i);
  });

  it("détaille la TVA taux par taux", async () => {
    const texte = texteDuPdf(await renderJournalZPdf(journal(), branding()));
    expect(texte).toContain("0 %");
    expect(texte).toContain("7 %");
    expect(texte).toContain("20 %");
    expect(texte).toContain("104,00 MAD");
  });

  it("signale les ventes rattrapées, qui faussent la lecture des totaux", async () => {
    const texte = texteDuPdf(
      await renderJournalZPdf(journal({ rattrapagesOffline: 3 }), branding()),
    );
    expect(texte).toContain("3 vente(s) hors ligne");
  });

  it("se tait sur les rattrapages quand il n'y en a pas", async () => {
    const texte = texteDuPdf(await renderJournalZPdf(journal(), branding()));
    expect(texte).not.toMatch(/hors ligne/);
  });

  it("porte la zone de signature et la mention Akribis", async () => {
    const texte = texteDuPdf(await renderJournalZPdf(journal(), branding()));
    // Deux cadres, comme sur le bordereau : l'officine signe, le
    // comptable vise. Un simple trait ne disait pas qui devait signer quoi.
    expect(texte).toContain("Cachet et signature du pharmacien");
    expect(texte).toContain("Visa du comptable");
    expect(texte).toContain("Propulsé par Akribis Pharma - www.pharma.akribis.ma");
    expect(texte).toMatch(/Édité le \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} · Page 1 \/ 1/);
  });

  it("sort un PDF valide et non vide", async () => {
    const pdf = await renderJournalZPdf(journal(), branding());
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
});
