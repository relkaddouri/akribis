import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderAvecProviders } from "@/tests/fixtures/render-avec-providers";
import { CheckoutPanel } from "@/components/features/pos/cart-panel";
import type { SelectedClient } from "@/components/features/pos/client-picker";
import type { CartLine } from "@/lib/pos/cart";
import type { OrganismeRecord } from "@/lib/server/organismes";

const CNSS: OrganismeRecord = {
  id: "org-1",
  nom: "CNSS/AMO",
  code: "CNSS",
  tauxCouverture: 70,
  formatBordereau: null,
  actif: true,
};

/**
 * L'avertissement de dépassement, tel qu'il apparaît en caisse.
 *
 * Ce qui compte ici tient en deux points, et ce sont les deux qu'un
 * correctif maladroit casserait : l'alerte est **visible** — un rôle
 * `alert`, un chiffre, pas une pastille grise —, et elle **ne bloque
 * pas**. Le plafond est une consigne de gestion ; c'est le pharmacien,
 * qui a le client devant lui, qui tranche.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

function ligne(overrides: Partial<CartLine> = {}): CartLine {
  return {
    productId: "p1",
    productName: "DOLIPRANE 500 mg",
    unitPrice: 200,
    quantity: 1,
    availableStock: 50,
    remboursable: false,
    baseRemboursement: null,
    ...overrides,
  };
}

function client(overrides: Partial<NonNullable<SelectedClient>> = {}): SelectedClient {
  return {
    id: "cli-1",
    name: "Fatima Bennani",
    solde: -700,
    plafondCredit: 1000,
    insurerId: null,
    numeroImmatriculation: null,
    ...overrides,
  };
}

function rendreCaisse(
  options: {
    client?: SelectedClient;
    paymentMethod?: "CASH" | "CARD" | "CREDIT";
    lines?: CartLine[];
  } = {},
) {
  return renderAvecProviders(
    <CheckoutPanel
      lines={options.lines ?? [ligne({ unitPrice: 450 })]}
      paymentMethod={options.paymentMethod ?? "CREDIT"}
      onChangePaymentMethod={() => {}}
      cashReceived={0}
      onChangeCashReceived={() => {}}
      onValidate={() => {}}
      isSubmitting={false}
      canValidate
      client={options.client === undefined ? client() : options.client}
      organismes={[]}
      insurerId={null}
      onChangeInsurer={() => {}}
    />,
  );
}

const alerte = () => screen.queryByRole("alert");

describe("avertissement de dépassement de plafond", () => {
  it("s'affiche quand la vente pousse l'encours au-delà du plafond", () => {
    // Doit déjà 700, plafond 1000, vente à crédit de 450 → 1150, soit 150
    // de trop.
    rendreCaisse();

    expect(alerte()).toBeTruthy();
    expect(alerte()).toHaveTextContent("Plafond de crédit dépassé de 150,00 MAD");
  });

  it("donne les trois nombres qui permettent de décider", () => {
    rendreCaisse();

    // Les espaces Unicode sont ramenées à l'espace ordinaire : le
    // séparateur de milliers du français est U+202F, invisible à la
    // relecture, et une assertion écrite avec une espace normale échoue
    // sans qu'on voie pourquoi.
    const texte = alerte()!.textContent!.replace(/[\u00a0\u202f\s]/g, " ");
    expect(texte).toContain("700,00"); // ce qu'il doit déjà
    expect(texte).toContain("1 150,00"); // ce qu'il devrait après
    expect(texte).toContain("1 000,00"); // le plafond
    expect(texte).toContain("Fatima Bennani");
  });

  it("ne bloque pas la validation", () => {
    // Le point de la demande : « ne bloque pas la vente, c'est au
    // pharmacien de décider en dernier ressort ».
    rendreCaisse();

    expect(alerte()).toBeTruthy();
    expect(screen.getByRole("button", { name: /valider/i })).not.toBeDisabled();
    expect(alerte()).toHaveTextContent("La vente reste possible");
  });

  it("se tait tant que le plafond tient", () => {
    rendreCaisse({ lines: [ligne({ unitPrice: 200 })] });
    expect(alerte()).toBeNull();
  });

  it("se tait quand aucun plafond n'est fixé", () => {
    rendreCaisse({ client: client({ plafondCredit: null }) });
    expect(alerte()).toBeNull();
  });

  it("se tait sur un paiement comptant, qui ne porte rien au compte", () => {
    // Le plafond ne concerne que le crédit : avertir sur une vente réglée
    // en espèces ferait du bruit à chaque passage d'un client endetté.
    rendreCaisse({ paymentMethod: "CASH" });
    expect(alerte()).toBeNull();
  });

  it("se tait sans client attaché", () => {
    rendreCaisse({ client: null });
    expect(alerte()).toBeNull();
  });

  it("compte le total de la vente, pas la seule part client", () => {
    /*
     * Décision délibérée, et contre-intuitive : en tiers payant, la caisse
     * n'encaisse que la part client, mais lib/server/sales.ts porte le
     * TOTAL au compte sur une vente à crédit
     * (`creditSaleMovement(totalAmount)`). Avertir sur la part client
     * annoncerait un risque plus faible que celui réellement pris.
     *
     * Ici : ticket de 450, dont 315 réclamés à la CNSS ; le client n'en
     * règle que 135 au comptoir, mais son compte est débité de 450 —
     * dépassement de 150, pas de rien du tout.
     */
    renderAvecProviders(
      <CheckoutPanel
        lines={[ligne({ unitPrice: 450, remboursable: true, baseRemboursement: 450 })]}
        paymentMethod="CREDIT"
        onChangePaymentMethod={() => {}}
        cashReceived={0}
        onChangeCashReceived={() => {}}
        onValidate={() => {}}
        isSubmitting={false}
        canValidate
        client={client()}
        organismes={[CNSS]}
        insurerId="org-1"
        onChangeInsurer={() => {}}
      />,
    );

    expect(alerte()).toHaveTextContent("dépassé de 150,00 MAD");
  });
});
