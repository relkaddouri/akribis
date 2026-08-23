import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import { renderInvoicePdf } from "@/lib/invoices/pdf";
import { chargeUtileQr, matriceQr } from "@/lib/invoices/qr-code";
import { A4, MARGIN } from "@/lib/pdf/document";
import type { InvoiceDetail } from "@/lib/server/invoices";

/**
 * Le QR code de la facture, relu.
 *
 * Le test ne se contente pas de comparer deux appels à la même
 * bibliothèque : il **relit le symbole tel qu'il est dessiné sur le PDF
 * produit**, avec un décodeur indépendant (jsQR). Un encodeur comparé à
 * lui-même passerait au vert même en dessinant la matrice à l'envers, ou
 * en la traçant hors de la page.
 *
 * Le chemin est donc : facture → PDF → flux de contenu décompressé →
 * rectangles → matrice reconstruite → image → jsQR → chaîne → comparaison
 * avec les données réelles de la facture.
 */

function facture(surcharges: Partial<InvoiceDetail> = {}): InvoiceDetail {
  return {
    id: "inv-1",
    number: "FACT-2026-0042",
    issuedAt: new Date("2026-08-22T10:00:00"),
    clientName: "Mutuelle CNOPS",
    status: "issued",
    pharmacyName: "Pharmacie Akribis",
    pharmacyAddress: "12 avenue Hassan II, Casablanca",
    pharmacyPhone: "0522000000",
    pharmacyIce: "001234567000089",
    pharmacyIdentifiantFiscal: "40912345",
    totalHt: 1041.67,
    totalTva: 208.33,
    totalTtc: 1250,
    lines: [
      {
        id: "l1",
        designation: "Doliprane 500mg",
        quantity: 5,
        unitPriceHt: 208.334,
        tvaRate: 20,
        totalHt: 1041.67,
        totalTva: 208.33,
        totalTtc: 1250,
      },
    ],
    saleIds: ["s1"],
    ...surcharges,
  };
}

// ── Relecture du PDF ────────────────────────────────────────────────────

/**
 * Les flux de contenu du PDF, décompressés.
 *
 * pdf-lib comprime tout en Flate : chercher un opérateur en clair dans les
 * octets rendus ne trouve jamais rien. Les flux illisibles (tables de
 * références croisées, polices) sont ignorés en silence — on ne cherche
 * ici que celui qui porte les instructions de dessin.
 */
function fluxDeContenu(pdf: Uint8Array): string[] {
  const brut = Buffer.from(pdf);
  const flux: string[] = [];
  let position = 0;

  for (;;) {
    const debut = brut.indexOf("stream", position);
    if (debut === -1) break;
    const fin = brut.indexOf("endstream", debut);
    if (fin === -1) break;

    // Le mot-clé est suivi d'un saut de ligne, parfois précédé d'un retour
    // chariot ; le flux commence après.
    let depart = debut + "stream".length;
    if (brut[depart] === 0x0d) depart += 1;
    if (brut[depart] === 0x0a) depart += 1;

    try {
      flux.push(inflateSync(brut.subarray(depart, fin)).toString("latin1"));
    } catch {
      // Flux non compressé ou non déchiffrable : sans intérêt ici.
    }
    // Après le mot-clé entier : `fin + 1` retombe sur le « stream » que
    // contient « endstream », et la recherche suivante saute alors par
    // dessus le flux d'après — celui du QR, sur une facture à deux pages.
    position = fin + "endstream".length;
  }
  return flux;
}

type Rectangle = { x: number; y: number; largeur: number; hauteur: number };

/**
 * Les rectangles pleins du PDF. Seul le QR code en dessine.
 *
 * pdf-lib n'émet **pas** l'opérateur `re` : `drawRectangle` produit une
 * matrice de translation puis un chemin fermé de quatre points, rempli
 * par `f`. Le motif ci-dessous suit donc cette forme précise — si ce test
 * casse un jour sans qu'on ait touché au QR code, c'est ici qu'il faut
 * regarder d'abord, et non dans lib/invoices/qr-code.ts.
 *
 *     1 0 0 1 <x> <y> cm
 *     0 0 m / 0 <h> l / <w> <h> l / <w> 0 l / h / f
 *
 * Les traits de séparation, tracés par `drawLine`, ne correspondent pas :
 * ils s'arrêtent à `S` sans fermer de chemin.
 */
function rectangles(pdf: Uint8Array): Rectangle[] {
  const motif =
    /1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm\n(?:1 0 0 1 0 0 cm\n)*0 0 m\n0 (-?[\d.]+) l\n(-?[\d.]+) -?[\d.]+ l\n-?[\d.]+ 0 l\nh\nf/g;
  return fluxDeContenu(pdf).flatMap((flux) =>
    [...flux.matchAll(motif)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
      hauteur: Number(m[3]),
      largeur: Number(m[4]),
    })),
  );
}

/**
 * Reconstruit la matrice depuis les rectangles dessinés.
 *
 * Tout est déduit du tracé lui-même — pas de constante recopiée depuis le
 * moteur de rendu : le pas de la grille vient du plus petit écart entre
 * deux colonnes voisines, l'origine des coordonnées minimales, la taille
 * de l'étendue. Un QR porte toujours un motif de repérage dans trois
 * coins, ce qui garantit que la première et la dernière colonne comme la
 * dernière ligne contiennent des modules noirs.
 */
function matriceDepuisPdf(pdf: Uint8Array): {
  matrice: boolean[][];
  cadre: { x: number; y: number; cote: number };
} {
  const rects = rectangles(pdf);
  expect(rects.length, "aucun rectangle dessiné : pas de QR code sur la page").toBeGreaterThan(0);

  const xs = [...new Set(rects.map((r) => r.x))].sort((a, b) => a - b);
  const ys = rects.map((r) => r.y);
  const pas = Math.min(...xs.slice(1).map((valeur, i) => valeur - xs[i]!));
  const x0 = xs[0]!;
  const y0 = Math.min(...ys);
  const modules = Math.round((xs.at(-1)! - x0) / pas) + 1;

  const matrice = Array.from({ length: modules }, () =>
    Array.from({ length: modules }, () => false),
  );
  for (const rect of rects) {
    const colonne = Math.round((rect.x - x0) / pas);
    const ligne = modules - 1 - Math.round((rect.y - y0) / pas);
    matrice[ligne]![colonne] = true;
  }
  return { matrice, cadre: { x: x0, y: y0, cote: modules * pas } };
}

/**
 * Les points d'ancrage du texte de la page qui porte le QR code.
 *
 * pdf-lib pose chaque fragment de texte par `1 0 0 1 <x> <y> Tm` entre
 * `BT` et `ET`. Sert à vérifier qu'aucun texte ne vient se poser sur le
 * symbole — un QR recouvert par les totaux se lit encore, ce sont les
 * totaux qui deviennent illisibles, et aucun décodage ne le signalerait.
 */
function ancragesTexte(pdf: Uint8Array): Array<{ x: number; y: number }> {
  const avecQr = fluxDeContenu(pdf).filter((flux) => flux.includes("0 0 m"));
  const motif = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g;
  return avecQr.flatMap((flux) =>
    [...flux.matchAll(motif)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) })),
  );
}

/**
 * Rasterise les rectangles **tels qu'ils sont tracés**, puis décode.
 *
 * Complément indispensable à `matriceDepuisPdf`, qui reconstruit une
 * matrice idéale à partir des seules coordonnées : elle ignore la taille
 * réelle des rectangles, donc le débord de `qrMatrix` — un module noir
 * est dessiné un peu plus grand que son pas pour éviter les cheveux
 * blancs entre voisins. Poussé trop loin, ce débord empâterait le
 * symbole jusqu'à le rendre illisible, et aucun des autres tests ne le
 * verrait : ils travaillent sur une grille parfaite.
 *
 * `pxParModule` bas simule un scan grossier — photo de travers,
 * photocopie, appareil bas de gamme.
 */
function decoderGeometrieReelle(pdf: Uint8Array, pxParModule: number): string | null {
  const rects = rectangles(pdf);
  const xs = [...new Set(rects.map((r) => r.x))].sort((a, b) => a - b);
  const pas = Math.min(...xs.slice(1).map((valeur, i) => valeur - xs[i]!));
  const modules = Math.round((xs.at(-1)! - xs[0]!) / pas) + 1;

  const MARGE = 4;
  const echelle = pxParModule / pas;
  const x0 = xs[0]!;
  const hautDuSymbole = Math.min(...rects.map((r) => r.y)) + modules * pas;
  const cote = (modules + 2 * MARGE) * pxParModule;

  const pixels = new Uint8ClampedArray(cote * cote * 4).fill(255);
  for (const rect of rects) {
    const gauche = Math.round((rect.x - x0) * echelle) + MARGE * pxParModule;
    const haut = Math.round((hautDuSymbole - (rect.y + rect.hauteur)) * echelle) + MARGE * pxParModule;
    for (let dy = 0; dy < Math.round(rect.hauteur * echelle); dy += 1) {
      for (let dx = 0; dx < Math.round(rect.largeur * echelle); dx += 1) {
        const x = gauche + dx;
        const y = haut + dy;
        if (x < 0 || y < 0 || x >= cote || y >= cote) continue;
        const i = (y * cote + x) * 4;
        pixels[i] = 0;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
      }
    }
  }
  return jsQR(pixels, cote, cote)?.data ?? null;
}

/**
 * Décode une matrice avec jsQR.
 *
 * Chaque module devient un carré de 8 px et le symbole reçoit une marge
 * de 4 modules : jsQR cherche les motifs de repérage dans une image, et
 * un symbole collé au bord, sans zone de silence, ne se repère pas.
 */
function decoder(matrice: boolean[][]): string | null {
  const ECHELLE = 8;
  const MARGE = 4;
  const modules = matrice.length + 2 * MARGE;
  const cote = modules * ECHELLE;

  const pixels = new Uint8ClampedArray(cote * cote * 4).fill(255);
  for (let ligne = 0; ligne < matrice.length; ligne += 1) {
    for (let colonne = 0; colonne < matrice.length; colonne += 1) {
      if (!matrice[ligne]![colonne]) continue;
      for (let dy = 0; dy < ECHELLE; dy += 1) {
        for (let dx = 0; dx < ECHELLE; dx += 1) {
          const px = (colonne + MARGE) * ECHELLE + dx;
          const py = (ligne + MARGE) * ECHELLE + dy;
          const i = (py * cote + px) * 4;
          pixels[i] = 0;
          pixels[i + 1] = 0;
          pixels[i + 2] = 0;
        }
      }
    }
  }
  return jsQR(pixels, cote, cote)?.data ?? null;
}

// ── Les tests ───────────────────────────────────────────────────────────

describe("le QR code dessiné sur la facture se relit", () => {
  it("décode exactement les informations de la facture", async () => {
    const donnees = facture();
    const decode = decoder(matriceDepuisPdf(await renderInvoicePdf(donnees)).matrice);

    expect(decode).toBe("FACTURE FACT-2026-0042 - 22/08/2026 - TOTAL TTC 1250.00 MAD - IF 40912345");

    // Et champ par champ, contre la facture elle-même plutôt que contre
    // une chaîne recopiée : c'est ce que la demande veut voir vérifié.
    const segments = decode!.split(" - ");
    expect(segments).toEqual([
      `FACTURE ${donnees.number}`,
      "22/08/2026",
      `TOTAL TTC ${donnees.totalTtc.toFixed(2)} MAD`,
      `IF ${donnees.pharmacyIdentifiantFiscal}`,
    ]);
  });

  it("se relit sur le tracé réel, jusqu'à un scan grossier", async () => {
    // Les autres cas décodent une matrice reconstruite depuis les seules
    // coordonnées : une grille parfaite, que le débord de tracé
    // n'atteint pas. Ici c'est la géométrie effective qui est peinte,
    // débord compris, et à des résolutions décroissantes — la plus basse
    // vaut environ deux pixels par module, soit une photo médiocre.
    const pdf = await renderInvoicePdf(facture());
    for (const pxParModule of [10, 6, 4, 2]) {
      expect(
        decoderGeometrieReelle(pdf, pxParModule),
        `illisible à ${pxParModule} px par module`,
      ).toBe("FACTURE FACT-2026-0042 - 22/08/2026 - TOTAL TTC 1250.00 MAD - IF 40912345");
    }
  });

  it("est dessiné dans le bon sens, module par module", async () => {
    /*
     * jsQR relit un symbole retourné ou transposé — il redresse l'image
     * avant de décoder. Un téléphone, non. Le décodage seul laisserait
     * donc passer une matrice tracée en miroir, qui ne servirait à
     * personne au comptoir.
     *
     * D'où cette seconde assertion, complémentaire et non redondante :
     * jsQR prouve que le **contenu** est le bon, avec un décodeur
     * indépendant ; la comparaison ci-dessous prouve que chaque module
     * est **à sa place**, l'encodeur faisant foi sur la géométrie.
     */
    const donnees = facture();
    const { matrice } = matriceDepuisPdf(await renderInvoicePdf(donnees));
    const attendue = matriceQr(
      chargeUtileQr({
        identifiantFiscal: donnees.pharmacyIdentifiantFiscal,
        numero: donnees.number,
        dateEmission: donnees.issuedAt,
        totalTtc: donnees.totalTtc,
      }),
    );

    expect(matrice.length).toBe(attendue.length);
    expect(matrice).toEqual(attendue);
  });

  it("suit la facture quand ses données changent", async () => {
    // Sans ce second cas, un QR figé sur une chaîne constante passerait
    // le test précédent.
    const decode = decoder(
      matriceDepuisPdf(
        await renderInvoicePdf(
          facture({
            number: "FACT-2027-0001",
            pharmacyIdentifiantFiscal: "99887766",
            issuedAt: new Date("2027-01-05T09:00:00"),
            totalTtc: 87.4,
          }),
        ),
      ).matrice,
    );

    expect(decode).toBe(
      "FACTURE FACT-2027-0001 - 05/01/2027 - TOTAL TTC 87.40 MAD - IF 99887766",
    );
  });

  it("garde des modules assez grands pour un téléphone", async () => {
    /*
     * C'est la taille du **module**, pas celle du symbole, qui décide de
     * ce qu'un appareil photo arrive à lire — de travers, sur une
     * photocopie, sous un néon. La première version tenait 33 modules
     * dans 85 pt, soit 0,91 mm par module : lisible par un décodeur
     * logiciel, à la limite pour un téléphone.
     *
     * Le seuil vaut donc pour les deux facteurs à la fois : agrandir le
     * symbole, ou densifier l'encodage, améliore le chiffre ; allonger
     * la charge utile le dégrade. Un futur format DGI plus bavard
     * fera échouer ce test, et c'est exactement ce qu'on veut savoir.
     */
    const PT_EN_MM = 25.4 / 72;
    const { matrice, cadre } = matriceDepuisPdf(await renderInvoicePdf(facture()));
    const pasEnMm = (cadre.cote / matrice.length) * PT_EN_MM;

    expect(
      pasEnMm,
      `module de ${pasEnMm.toFixed(2)} mm — trop petit pour un scan fiable`,
    ).toBeGreaterThanOrEqual(1.2);
  });

  it("se pose en bas à droite de la page", async () => {
    const { cadre } = matriceDepuisPdf(await renderInvoicePdf(facture()));

    // À la marge près, contre le bord droit et le bas de la zone
    // imprimable. Un symbole qui flotte au milieu se scanne mal : on le
    // cherche, et sur une pile de factures on ne le cherche pas deux fois.
    expect(cadre.x + cadre.cote).toBeCloseTo(A4.width - MARGIN, 0);
    expect(cadre.y).toBeCloseTo(MARGIN, 0);
  });

  it("n'est jamais recouvert par les totaux, quelle que soit la longueur", async () => {
    /*
     * Le cas dangereux n'est pas la facture très longue : c'est celle qui
     * s'arrête *juste* au-dessus du seuil de pagination. Les totaux
     * descendent alors le plus bas possible sur la dernière page, et
     * viennent se poser sur le symbole. Un seul nombre de lignes ne
     * tombe presque jamais dessus — d'où le balayage.
     *
     * Et le décodage ne dirait rien : le QR est tracé en dernier, donc
     * par-dessus. C'est le total TTC imprimé qui devient illisible.
     */
    for (let nombre = 1; nombre <= 80; nombre += 1) {
      const lignes = Array.from({ length: nombre }, (_, i) => ({
        id: `l${i}`,
        designation: `Produit ${i}`,
        quantity: 1,
        unitPriceHt: 10,
        tvaRate: i % 2 === 0 ? 20 : 7,
        totalHt: 10,
        totalTva: 2,
        totalTtc: 12,
      }));

      const pdf = await renderInvoicePdf(facture({ lines: lignes }));
      const { matrice, cadre } = matriceDepuisPdf(pdf);

      expect(decoder(matrice), `${nombre} ligne(s) : QR illisible`).toBe("FACTURE FACT-2026-0042 - 22/08/2026 - TOTAL TTC 1250.00 MAD - IF 40912345");

      const dansLeCadre = ancragesTexte(pdf).filter(
        (point) =>
          point.x >= cadre.x - 2 &&
          point.y >= cadre.y - 2 &&
          point.y <= cadre.y + cadre.cote + 2,
      );
      expect(dansLeCadre, `${nombre} ligne(s) : du texte est imprimé sur le QR`).toEqual([]);
    }
  });

  it("omet le champ IF quand l'officine n'en a pas", async () => {
    // Facture émise avant que le champ n'existe. Un « IF » suivi de rien
    // se lirait comme une anomalie de la facture, alors que c'est une
    // donnée jamais saisie. Les étiquettes rendent la position des autres
    // champs indifférente, donc rien ne glisse.
    const decode = decoder(
      matriceDepuisPdf(await renderInvoicePdf(facture({ pharmacyIdentifiantFiscal: null })))
        .matrice,
    );
    expect(decode).toBe("FACTURE FACT-2026-0042 - 22/08/2026 - TOTAL TTC 1250.00 MAD");
    expect(decode).not.toContain("IF");
  });
});

describe("la charge utile", () => {
  it("reste dans le jeu alphanumérique du QR", () => {
    /*
     * Le point qui commande la densité. Le jeu alphanumérique tient
     * chiffres, MAJUSCULES, espace et `$ % * + - . / :`. Un seul
     * caractère en dehors — une minuscule, une barre verticale — bascule
     * tout le symbole en mode octet et rétrécit les modules de 15 %,
     * sans que rien ne le signale.
     */
    const charge = chargeUtileQr({
      identifiantFiscal: "237878237823",
      numero: "fact-2026-0001",
      dateEmission: new Date(2026, 7, 17),
      totalTtc: 1250,
    });

    expect(charge).toMatch(/^[0-9A-Z $%*+\-./:]*$/);
    // La mise en majuscules n'est pas cosmétique : c'est elle qui garde
    // un numéro saisi en minuscules dans le jeu dense.
    expect(charge).toContain("FACTURE FACT-2026-0001");
  });


  it("prend la date locale, pas la date UTC", () => {
    // `toISOString()` reculerait au 29 février une facture émise à
    // Casablanca le 1er mars à 00 h 30 — le QR contredirait alors la date
    // imprimée juste au-dessus de lui.
    const minuitPasse = new Date(2026, 2, 1, 0, 30);
    expect(
      chargeUtileQr({
        identifiantFiscal: "40912345",
        numero: "FACT-2026-0001",
        dateEmission: minuitPasse,
        totalTtc: 10,
      }),
    ).toContain("01/03/2026");
  });

  it("écarte un séparateur glissé dans un champ", () => {
    // Sinon le lecteur découperait au mauvais endroit et lirait tout ce
    // qui suit de travers, sans que rien ne le signale. Le tiret seul,
    // lui, doit survivre : les numéros de facture en contiennent.
    const charge = chargeUtileQr({
      identifiantFiscal: "409 - 12345",
      numero: "FACT-2026-0001",
      dateEmission: new Date(2026, 7, 22),
      totalTtc: 10,
    });
    expect(charge).toBe(
      "FACTURE FACT-2026-0001 - 22/08/2026 - TOTAL TTC 10.00 MAD - IF 409 12345",
    );
    expect(charge.split(" - ")).toHaveLength(4);
  });

  it("écrit le montant sans séparateur de milliers, et en point décimal", () => {
    // Deux raisons distinctes. Le séparateur de milliers français est une
    // espace fine insécable, hors jeu alphanumérique ; et la virgule
    // décimale en est absente elle aussi. Le montant imprimé sur la
    // facture, lui, reste bien formaté à la française.
    expect(
      chargeUtileQr({
        identifiantFiscal: "1",
        numero: "F",
        dateEmission: new Date(2026, 0, 1),
        totalTtc: 1234567.5,
      }),
    ).toContain("TOTAL TTC 1234567.50 MAD");
  });

  it("produit une matrice carrée non vide", () => {
    const matrice = matriceQr("IF:1*FACT:F*DATE:2026-01-01*TTC:1.00");
    expect(matrice.length).toBeGreaterThan(0);
    expect(matrice.every((ligne) => ligne.length === matrice.length)).toBe(true);
    expect(matrice.flat().some(Boolean)).toBe(true);
  });
});
