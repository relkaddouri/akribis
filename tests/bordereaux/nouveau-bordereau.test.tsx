import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderAvecProviders } from "@/tests/fixtures/render-avec-providers";
import { NouveauBordereauForm } from "@/components/features/bordereaux/nouveau-bordereau-form";
import {
  listVentesEligibles,
  type VenteEligible,
} from "@/lib/server/bordereaux";
import type { OrganismeRecord } from "@/lib/server/organismes";

/**
 * L'écran de création, après refonte : l'aperçu se charge seul et le
 * récapitulatif reste sous les yeux.
 *
 * Ce que ce fichier verrouille, ce sont les conséquences de ce choix.
 * Charger seul veut dire lancer plusieurs requêtes au fil des clics ; la
 * mauvaise qui arrive en dernier afficherait un total qui n'est pas celui
 * du bordereau sur le point d'être créé. Et le récapitulatif porte la
 * somme engagée : il totalise les parts organisme, jamais les tickets
 * complets.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/server/bordereaux", () => ({
  listVentesEligibles: vi.fn(),
  createBordereau: vi.fn(),
}));

const listeMock = vi.mocked(listVentesEligibles);

const ORGANISMES: OrganismeRecord[] = [
  {
    id: "org-1",
    nom: "CNSS",
    code: "CNSS",
    tauxCouverture: 70,
    formatBordereau: null,
    actif: true,
  },
];

function vente(overrides: Partial<VenteEligible> = {}): VenteEligible {
  return {
    saleId: "s1",
    reference: "VTE-000001",
    createdAt: new Date("2026-07-12T09:00:00.000Z"),
    clientName: "Fatima B.",
    totalAmount: 15,
    montantPartAssurance: 10.5,
    ...overrides,
  };
}

beforeEach(() => {
  // `shouldAdvanceTime` : sans lui l'horloge figée gèle aussi les délais
  // sur lesquels `waitFor` s'appuie, et l'attente ne se réveille jamais.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  listeMock.mockReset();
  listeMock.mockResolvedValue([]);
});

afterEach(() => vi.useRealTimers());

describe("aperçu automatique", () => {
  it("part seul, sur le mois dernier, sans rien demander au pharmacien", async () => {
    vi.setSystemTime(new Date("2026-08-21T10:00:00"));
    renderAvecProviders(<NouveauBordereauForm organismes={ORGANISMES} />);

    // Le dernier jour du mois, pas le 30 ni le 1er août : la borne haute
    // est ce qui décide qu'une vente du 31 entre ou non dans le bordereau.
    await waitFor(() =>
      expect(listeMock).toHaveBeenCalledWith(
        "org-1",
        "2026-07-01",
        "2026-07-31",
      ),
    );
  });

  it("recule d'une année au passage de janvier", async () => {
    vi.setSystemTime(new Date("2027-01-15T10:00:00"));
    renderAvecProviders(<NouveauBordereauForm organismes={ORGANISMES} />);

    await waitFor(() =>
      expect(listeMock).toHaveBeenCalledWith(
        "org-1",
        "2026-12-01",
        "2026-12-31",
      ),
    );
  });

  it("n'interroge pas le serveur sur une période à l'envers, et le dit", async () => {
    vi.setSystemTime(new Date("2026-08-21T10:00:00"));
    renderAvecProviders(<NouveauBordereauForm organismes={ORGANISMES} />);
    await waitFor(() => expect(listeMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Au"), {
      target: { value: "2026-06-01" },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La date de fin précède la date de début",
    );
    expect(listeMock).toHaveBeenCalledTimes(1);
  });
});

describe("réponses concurrentes", () => {
  it("ignore l'aperçu devancé, même s'il arrive en dernier", async () => {
    vi.setSystemTime(new Date("2026-08-21T10:00:00"));

    const differes: Array<(v: VenteEligible[]) => void> = [];
    listeMock.mockImplementation(
      () => new Promise<VenteEligible[]>((resoudre) => differes.push(resoudre)),
    );

    renderAvecProviders(<NouveauBordereauForm organismes={ORGANISMES} />);
    await waitFor(() => expect(differes).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Ce mois-ci" }));
    await waitFor(() => expect(differes).toHaveLength(2));

    // La seconde période répond la première, puis la première la rattrape.
    differes[1]([vente({ saleId: "s-aout", reference: "VTE-000042" })]);
    await screen.findByText("VTE-000042");

    differes[0]([
      vente({ saleId: "s-juillet-1", reference: "VTE-000001" }),
      vente({ saleId: "s-juillet-2", reference: "VTE-000002" }),
    ]);

    await waitFor(() =>
      expect(recapitulatif()).toHaveTextContent("1 vente · 10,50 MAD"),
    );
    expect(screen.getByText("VTE-000042")).toBeInTheDocument();
    expect(screen.queryByText("VTE-000001")).not.toBeInTheDocument();
  });
});

describe("récapitulatif", () => {
  it("engage la somme des parts organisme, pas celle des tickets", async () => {
    vi.setSystemTime(new Date("2026-08-21T10:00:00"));
    listeMock.mockResolvedValue([
      vente({
        saleId: "s1",
        reference: "VTE-000001",
        totalAmount: 15,
        montantPartAssurance: 10.5,
      }),
      vente({
        saleId: "s2",
        reference: "VTE-000002",
        totalAmount: 8,
        montantPartAssurance: 4.25,
      }),
    ]);

    renderAvecProviders(<NouveauBordereauForm organismes={ORGANISMES} />);

    // 10,50 + 4,25 — et surtout pas 23,00, qui réclamerait à l'organisme
    // la part déjà payée par le client.
    await waitFor(() =>
      expect(recapitulatif()).toHaveTextContent("2 ventes · 14,75 MAD"),
    );
    expect(recapitulatif()).not.toHaveTextContent("23,00");
  });
});

/** Le bloc collant sous la liste : le seul qui porte un total. */
function recapitulatif(): HTMLElement {
  return screen.getByText(/vente(s?) ·/).closest("p")!;
}
