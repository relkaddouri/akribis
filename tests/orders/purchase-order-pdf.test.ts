import { describe, expect, it } from "vitest";
import { renderPurchaseOrderPdf } from "@/lib/orders/purchase-order-pdf";
import { formatCreditNumber, formatDeliveryNumber, formatOrderNumber } from "@/lib/orders/numbering";

const branding = {
  pharmacyName: "Pharmacie Akribis",
  address: "12 avenue Hassan II, Casablanca",
  phone: "0522000000",
  ice: "001234567000089",
  inpe: null,
  patente: null,
  logoUrl: null,
  showLogo: false,
  legalNotice: null,
  thankYouMessage: null,
};

const order = {
  numero: 7,
  createdAt: new Date("2026-08-10T10:00:00Z"),
  supplierName: "Pharma Distrib Maroc",
  supplierPhone: "0522111111",
  supplierEmail: "contact@pharmadistrib.ma",
  lines: [
    { productName: "Doliprane 500mg", quantity: 40, unitPrice: 12.5 },
    { productName: "Amoxicilline 500mg", quantity: 20, unitPrice: 28 },
  ],
  totalAmount: 1060,
};

describe("renderPurchaseOrderPdf", () => {
  it("produces a real PDF document", async () => {
    const bytes = await renderPurchaseOrderPdf(order, branding);

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("renders French accents without throwing", async () => {
    // The shared WinAnsi normaliser is the guard here; an unescaped
    // character throws at draw time rather than degrading.
    const bytes = await renderPurchaseOrderPdf(
      {
        ...order,
        supplierName: "Société Générale de Répartition",
        lines: [
          { productName: "Sérum physiologique — unité stérilisée", quantity: 5, unitPrice: 9.9 },
        ],
      },
      branding,
    );

    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("paginates instead of overflowing on a long order", async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      productName: `Produit numéro ${i + 1} avec un nom délibérément très long`,
      quantity: 3,
      unitPrice: 10,
    }));

    const bytes = await renderPurchaseOrderPdf({ ...order, lines: many }, branding);
    expect(bytes.byteLength).toBeGreaterThan(2000);
  });

  it("still renders when the supplier has no contact details", async () => {
    const bytes = await renderPurchaseOrderPdf(
      { ...order, supplierPhone: null, supplierEmail: null },
      branding,
    );
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});

describe("document numbering labels", () => {
  it("pads each family to its own prefix", () => {
    expect(formatOrderNumber(7)).toBe("CMD-0007");
    expect(formatDeliveryNumber(12)).toBe("BL-0012");
    expect(formatCreditNumber(3)).toBe("AV-0003");
  });

  it("widens past 9999 rather than truncating", () => {
    expect(formatOrderNumber(10000)).toBe("CMD-10000");
  });
});
