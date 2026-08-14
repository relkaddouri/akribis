import { describe, expect, it } from "vitest";
import { renderInvoicePdf } from "@/lib/invoices/pdf";
import { computeInvoiceTotals, roundCentimes, summariseTvaByRate } from "@/lib/invoices/totals";
import type { InvoiceDetail } from "@/lib/server/invoices";

function invoice(overrides: Partial<InvoiceDetail> = {}): InvoiceDetail {
  return {
    id: "inv-1",
    number: "FACT-2026-0001",
    issuedAt: new Date("2026-08-09T10:00:00Z"),
    clientName: "Mutuelle CNOPS",
    status: "issued",
    pharmacyName: "Pharmacie Akribis",
    pharmacyAddress: "12 avenue Hassan II, Casablanca",
    pharmacyPhone: "0522000000",
    pharmacyIce: "001234567000089",
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
    saleIds: ["sale-1"],
    ...overrides,
  };
}

describe("renderInvoicePdf", () => {
  it("produces a real PDF document", async () => {
    const bytes = await renderInvoicePdf(invoice());

    // %PDF- magic header, then a non-trivial body.
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("renders French accents without throwing", async () => {
    // pdf-lib's standard fonts are WinAnsi-encoded and throw on anything
    // outside it, so accented product names are a real failure mode.
    const bytes = await renderInvoicePdf(
      invoice({
        clientName: "Société Générale d'Assurance",
        lines: [
          {
            id: "l1",
            designation: "Sérum physiologique — unité 5ml (stérilisé)",
            quantity: 3,
            unitPriceHt: 12.5,
            tvaRate: 7,
            totalHt: 37.5,
            totalTva: 2.63,
            totalTtc: 40.13,
          },
        ],
      }),
    );

    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("paginates instead of overflowing when there are many lines", async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      id: `l${i}`,
      designation: `Produit numéro ${i + 1} avec un nom délibérément très long pour tester la troncature`,
      quantity: 1,
      unitPriceHt: 10,
      tvaRate: 20,
      totalHt: 10,
      totalTva: 2,
      totalTtc: 12,
    }));

    const bytes = await renderInvoicePdf(invoice({ lines: many }));
    expect(bytes.byteLength).toBeGreaterThan(2000);
  });

  it("renders amounts of 1000 and above", async () => {
    // Regression guard: fr-FR groups thousands with U+202F, a narrow
    // no-break space WinAnsi cannot encode. Every invoice over 999 threw
    // until the shared normaliser handled it.
    const bytes = await renderInvoicePdf(
      invoice({
        totalHt: 12500,
        totalTva: 2500,
        totalTtc: 15000,
        lines: [
          {
            id: "l1",
            designation: "Commande en gros",
            quantity: 100,
            unitPriceHt: 125,
            tvaRate: 20,
            totalHt: 12500,
            totalTva: 2500,
            totalTtc: 15000,
          },
        ],
      }),
    );

    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("still renders a cancelled invoice", async () => {
    const bytes = await renderInvoicePdf(invoice({ status: "cancelled" }));
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});

describe("invoice totals", () => {
  it("adds VAT on top of HT prices", () => {
    const totals = computeInvoiceTotals([
      { productId: "p1", designation: "A", quantity: 2, unitPriceHt: 50, tvaRate: 20 },
    ]);

    expect(totals.totalHt).toBe(100);
    expect(totals.totalTva).toBe(20);
    expect(totals.totalTtc).toBe(120);
  });

  it("bills a product with no VAT rate at 0 %, not at a guessed rate", () => {
    const totals = computeInvoiceTotals([
      { productId: "p1", designation: "A", quantity: 1, unitPriceHt: 80, tvaRate: 0 },
    ]);

    expect(totals.totalTva).toBe(0);
    expect(totals.totalTtc).toBe(80);
  });

  it("makes the printed lines add up to the printed total", () => {
    // Rounding once at the end instead of per line would print amounts
    // that don't sum to the stated total.
    const totals = computeInvoiceTotals([
      { productId: "p1", designation: "A", quantity: 3, unitPriceHt: 3.33, tvaRate: 7 },
      { productId: "p2", designation: "B", quantity: 7, unitPriceHt: 1.11, tvaRate: 20 },
    ]);

    const sumHt = roundCentimes(totals.lines.reduce((s, l) => s + l.totalHt, 0));
    const sumTva = roundCentimes(totals.lines.reduce((s, l) => s + l.totalTva, 0));

    expect(sumHt).toBe(totals.totalHt);
    expect(sumTva).toBe(totals.totalTva);
    expect(roundCentimes(totals.totalHt + totals.totalTva)).toBe(totals.totalTtc);
  });

  it("groups the VAT recap by rate", () => {
    const totals = computeInvoiceTotals([
      { productId: "p1", designation: "A", quantity: 1, unitPriceHt: 100, tvaRate: 20 },
      { productId: "p2", designation: "B", quantity: 1, unitPriceHt: 100, tvaRate: 7 },
      { productId: "p3", designation: "C", quantity: 1, unitPriceHt: 50, tvaRate: 20 },
    ]);

    expect(summariseTvaByRate(totals.lines)).toEqual([
      { rate: 7, baseHt: 100, tva: 7 },
      { rate: 20, baseHt: 150, tva: 30 },
    ]);
  });

  it("rounds half up at the centime instead of drifting on float error", () => {
    expect(roundCentimes(1.005)).toBe(1.01);
    expect(roundCentimes(2.675)).toBe(2.68);
  });
});
