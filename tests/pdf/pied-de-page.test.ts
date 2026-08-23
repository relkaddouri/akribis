import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { renderInvoicePdf } from "@/lib/invoices/pdf";
import { PIED_MARQUE } from "@/lib/pdf/document";
import type { InvoiceDetail } from "@/lib/server/invoices";

/**
 * Le pied de page, sur **tous** les documents.
 *
 * Trois des cinq n'en avaient aucun — facture, bon de commande, bon de
 * livraison — et rien ne le signalait : chaque rendu se relisait seul, et
 * l'absence ne se voyait qu'en posant deux impressions côte à côte.
 *
 * D'où l'invariant balayé ici plutôt qu'un test par document : un sixième
 * document ajouté demain sera pris par le même filet, sans que personne
 * ait à penser à l'y inscrire.
 */

const racine = resolve(__dirname, "../..");

/** Les modules de rendu PDF : ceux qui produisent un document entier. */
function renderersPdf(): string[] {
  const trouves: string[] = [];

  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(resolve(racine, dossier), { withFileTypes: true })) {
      const chemin = `${dossier}/${entree.name}`;
      if (entree.isDirectory()) {
        parcourir(chemin);
        continue;
      }
      if (!entree.name.endsWith(".ts")) continue;
      const source = readFileSync(resolve(racine, chemin), "utf8");
      // `doc.save()` est la signature d'un rendu complet : les modules
      // d'aide (primitives de tracé, QR) n'en appellent jamais.
      if (source.includes("doc.save()")) trouves.push(chemin);
    }
  };

  parcourir("lib");
  return trouves.sort();
}

describe("chaque document porte le même pied", () => {
  const renderers = renderersPdf();

  it("trouve bien les rendus PDF du dépôt", () => {
    // Garde-fou du test lui-même : si la détection cassait, l'assertion
    // suivante passerait sur une liste vide.
    expect(renderers.length).toBeGreaterThanOrEqual(5);
    expect(renderers).toContain("lib/invoices/pdf.ts");
    expect(renderers).toContain("lib/bordereaux/pdf.ts");
    expect(renderers).toContain("lib/caisse/journal-z-pdf.ts");
    expect(renderers).toContain("lib/orders/purchase-order-pdf.ts");
    expect(renderers).toContain("lib/orders/delivery-note-pdf.ts");
  });

  it.each(renderersPdf())("%s appelle le pied partagé", (chemin) => {
    const source = readFileSync(resolve(racine, chemin), "utf8");
    expect(source).toContain("piedDePage(");
  });

  it("aucun document ne réinvente son propre pied", () => {
    // L'ancienne mention anglaise vivait en double, dans le bordereau et
    // dans le Z, avec deux formulations qui pouvaient diverger.
    for (const chemin of renderers) {
      const source = readFileSync(resolve(racine, chemin), "utf8");
      expect(source, `${chemin} porte encore une mention en propre`).not.toContain(
        "Powered by Akribis",
      );
    }
  });
});

/** Le texte du PDF : pdf-lib comprime en Flate et écrit en hexadécimal. */
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
      // Flux non compressé : sans intérêt ici.
    }
    position = fin + "endstream".length;
  }
  return morceaux.join("\n");
}

function facture(surcharges: Partial<InvoiceDetail> = {}): InvoiceDetail {
  return {
    id: "3f2a9c41-7b6e-4d18-9e52-0a7c4b1d8e63",
    number: "FACT-2026-0042",
    issuedAt: new Date(2026, 7, 22),
    clientName: "Mutuelle CNOPS",
    status: "issued",
    pharmacyName: "Pharmacie Akribis",
    pharmacyAddress: "12 avenue Hassan II",
    pharmacyPhone: "0522000000",
    pharmacyIce: "001234567000089",
    pharmacyIdentifiantFiscal: "40912345",
    totalHt: 100,
    totalTva: 20,
    totalTtc: 120,
    lines: [
      {
        id: "l1",
        designation: "Doliprane 500mg",
        quantity: 2,
        unitPriceHt: 50,
        tvaRate: 20,
        totalHt: 100,
        totalTva: 20,
        totalTtc: 120,
      },
    ],
    saleIds: ["s1"],
    ...surcharges,
  };
}

describe("le pied sur la facture, imprimé", () => {
  it("porte la marque, l'adresse du site et la date d'édition", async () => {
    const texte = texteDuPdf(await renderInvoicePdf(facture()));

    expect(texte).toContain(PIED_MARQUE);
    expect(texte).toContain("www.pharma.akribis.ma");
    expect(texte).toMatch(/Édité le \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
  });

  it("numérote « 1 / 1 » sur un document d'une page", async () => {
    const texte = texteDuPdf(await renderInvoicePdf(facture()));
    expect(texte).toContain("Page 1 / 1");
  });

  it("compte les pages d'un document qui en a plusieurs", async () => {
    /*
     * Le total ne peut s'écrire qu'à la fin : c'est ce qui distingue ce
     * pied d'un simple texte posé au fil du rendu. Trente lignes
     * débordent sur une deuxième page, et les deux doivent porter
     * « / 2 » — y compris la première, écrite avant qu'on sache.
     */
    const lignes = Array.from({ length: 30 }, (_, i) => ({
      id: `l${i}`,
      designation: `Produit ${i}`,
      quantity: 1,
      unitPriceHt: 10,
      tvaRate: 20,
      totalHt: 10,
      totalTva: 2,
      totalTtc: 12,
    }));

    const texte = texteDuPdf(await renderInvoicePdf(facture({ lines: lignes })));

    expect(texte).toContain("Page 1 / 2");
    expect(texte).toContain("Page 2 / 2");
    expect(texte).not.toContain("Page 1 / 1");
  });
});
