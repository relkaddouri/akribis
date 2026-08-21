import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { screen, within } from "@testing-library/react";
import { renderAvecProviders } from "@/tests/fixtures/render-avec-providers";
import { ReceiptView } from "@/components/features/pos/receipt-view";
import type { Receipt } from "@/lib/offline/sales";

/**
 * Le ticket, en surimpression du comptoir.
 *
 * Il occupait une page entière : la caisse disparaissait le temps de le
 * lire, et « Nouvelle vente » était une navigation. Ce qui doit survivre
 * au changement, c'est l'impression — elle repose sur une règle
 * `@media print` qui n'affiche que `[data-print-area]`, et la boîte de
 * dialogue introduit un parent `fixed` translaté qui décalerait la feuille.
 */

vi.mock("@/lib/server/pharmacy", () => ({
  getReceiptBranding: vi.fn(async () => ({
    pharmacyName: "Pharmacie de Rachid",
    address: "APPT 5, TILILA AGADIR",
    phone: "0707114336",
    ice: "001234567000012",
    logoUrl: null,
    showLogo: false,
    legalNotice: "TVA non applicable",
    thankYouMessage: "Merci de votre visite !",
  })),
}));

const ticket: Receipt = {
  id: "s1",
  createdAt: new Date("2026-08-21T21:33:08.000Z"),
  paymentMethod: "CASH",
  totalAmount: 98,
  partClient: 98,
  partAssurance: 0,
  clientName: "Med EL KADDOURI",
  items: [
    { productId: "p1", productName: "ACEPRIL", quantity: 1, unitPrice: 98, lineTotal: 98 },
  ],
  priceDrifts: [],
};

describe("le ticket s'ouvre en surimpression", () => {
  it("est une boîte de dialogue, pas une page", () => {
    renderAvecProviders(<ReceiptView receipt={ticket} onNewSale={() => {}} />);
    const dialogue = screen.getByRole("dialog");
    expect(within(dialogue).getByText("Vente enregistrée")).toBeTruthy();
    expect(within(dialogue).getByText(/ACEPRIL/)).toBeTruthy();
  });

  it("garde les deux actions", () => {
    renderAvecProviders(<ReceiptView receipt={ticket} onNewSale={() => {}} />);
    expect(screen.getByRole("button", { name: /Imprimer/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nouvelle vente" })).toBeTruthy();
  });

  it("ne se ferme ni au clic extérieur ni par Échap", () => {
    // La vente est enregistrée, mais fermer par mégarde ferait perdre
    // l'occasion d'imprimer — et Échap sert déjà au comptoir.
    const src = readFileSync(
      resolve(__dirname, "../..", "components/features/pos/receipt-view.tsx"),
      "utf8",
    );
    expect(src).toMatch(/onEscapeKeyDown=\{\(event\) => event\.preventDefault\(\)\}/);
    expect(src).toMatch(/onInteractOutside=\{\(event\) => event\.preventDefault\(\)\}/);
  });

  it("se superpose au comptoir au lieu de le remplacer", () => {
    const src = readFileSync(
      resolve(__dirname, "../..", "components/features/pos/pos-view.tsx"),
      "utf8",
    );
    // Un `return <ReceiptView …>` anticipé démonterait la caisse.
    expect(src).not.toMatch(/if \(receipt\) \{\s*return/);
    expect(src).toMatch(/\{receipt && <ReceiptView/);
  });
});

describe("l'impression survit au passage en boîte de dialogue", () => {
  const css = () => readFileSync(resolve(__dirname, "../..", "app/globals.css"), "utf8");

  it("garde le cadrage sur la seule zone d'impression", () => {
    expect(css()).toMatch(/\[data-print-area\][\s\S]*?visibility: visible/);
  });

  it("remet le positionnement de la boîte à plat", () => {
    // Le contenu est `fixed` et translaté de −50 % : sans cette remise à
    // plat, le ticket se calerait sur ce parent décalé et l'on imprimerait
    // un quart de ticket au milieu d'une page vide.
    const impression = /@media print \{[\s\S]*\n\}/.exec(css());
    expect(impression, "bloc @media print introuvable").toBeTruthy();
    const regle = /\[data-slot="dialog-content"\] \{[\s\S]*?\}/.exec(impression![0]);
    expect(regle, "règle sur dialog-content absente").toBeTruthy();
    expect(regle![0]).toMatch(/position: static/);
    expect(regle![0]).toMatch(/transform: none/);
  });

  it("masque le voile de la boîte sur la feuille", () => {
    const impression = /@media print \{[\s\S]*\n\}/.exec(css());
    expect(impression![0]).toMatch(/\[data-slot="dialog-overlay"\] \{[\s\S]*?display: none/);
  });
});
