import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderAvecProviders } from "@/tests/fixtures/render-avec-providers";
import { OrganismesSection } from "@/components/features/settings/organismes-section";
import type { OrganismeRecord } from "@/lib/server/organismes";

/**
 * L'interface des organismes de tiers payant : ajouter, modifier,
 * désactiver. Jamais supprimer — et l'interface ne doit pas laisser croire
 * le contraire.
 */

const creer = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, id: "org-1" })));
const modifier = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, id: "org-1" })));
const basculer = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, id: "org-1" })));

vi.mock("@/lib/server/organismes", () => ({
  createOrganisme: creer,
  updateOrganisme: modifier,
  setOrganismeActif: basculer,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

function organisme(overrides: Partial<OrganismeRecord> = {}): OrganismeRecord {
  return {
    id: "org-1",
    nom: "CNSS/AMO",
    code: "CNSS",
    tauxCouverture: 70,
    formatBordereau: null,
    actif: true,
    ...overrides,
  };
}

const rendre = (organismes: OrganismeRecord[]) =>
  renderAvecProviders(<OrganismesSection organismes={organismes} />);

beforeEach(() => {
  creer.mockClear();
  modifier.mockClear();
  basculer.mockClear();
});

describe("la liste", () => {
  it("montre le nom, le code et le taux par défaut", () => {
    rendre([organisme()]);
    const ligne = screen.getByText("CNSS/AMO").closest("li")!;
    // Le code exactement, pas /CNSS/ : le nom le contient aussi, et une
    // assertion qui passe grâce au nom ne dit rien du code.
    expect(within(ligne).getByText("CNSS")).toBeTruthy();
    expect(within(ligne).getByText(/70 % par défaut/)).toBeTruthy();
  });

  it("montre le format de bordereau quand il y en a un", () => {
    rendre([organisme({ formatBordereau: "Bordereau mensuel, une ligne par vente" })]);
    expect(screen.getByText("Bordereau mensuel, une ligne par vente")).toBeTruthy();
  });

  it("invite à commencer quand la liste est vide", () => {
    rendre([]);
    expect(screen.getByText("Aucun organisme enregistré")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ajouter un organisme/ })).toBeTruthy();
  });

  it("n'offre nulle part de supprimer", () => {
    // Des ventes passées référencent l'organisme : un bouton « supprimer »
    // promettrait ce que la façade refuse.
    rendre([organisme()]);
    expect(screen.queryByRole("button", { name: /Supprimer/i })).toBeNull();
  });
});

describe("ajouter", () => {
  it("envoie les champs saisis", async () => {
    rendre([]);
    fireEvent.click(screen.getByRole("button", { name: /Ajouter un organisme/ }));

    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "CNOPS" } });
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "CNOPS-01" } });
    fireEvent.change(screen.getByLabelText("Taux de couverture par défaut"), {
      target: { value: "80" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter" }));

    await waitFor(() =>
      expect(creer).toHaveBeenCalledWith({
        nom: "CNOPS",
        code: "CNOPS-01",
        tauxCouverture: "80",
        formatBordereau: "",
      }),
    );
  });

  it("affiche l'erreur renvoyée par le serveur sans fermer le formulaire", async () => {
    creer.mockResolvedValueOnce({ ok: false, error: "Un organisme portant ce code existe déjà." } as never);
    rendre([]);
    fireEvent.click(screen.getByRole("button", { name: /Ajouter un organisme/ }));
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter" }));

    expect(await screen.findByText(/existe déjà/)).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("modifier", () => {
  it("ouvre le formulaire pré-rempli", () => {
    rendre([organisme({ formatBordereau: "Mensuel" })]);
    fireEvent.click(screen.getByRole("button", { name: "Modifier CNSS/AMO" }));

    expect((screen.getByLabelText("Nom") as HTMLInputElement).value).toBe("CNSS/AMO");
    expect((screen.getByLabelText("Code") as HTMLInputElement).value).toBe("CNSS");
    expect(
      (screen.getByLabelText("Taux de couverture par défaut") as HTMLInputElement).value,
    ).toBe("70");
    expect((screen.getByLabelText("Format de bordereau") as HTMLTextAreaElement).value).toBe(
      "Mensuel",
    );
  });

  it("appelle la mise à jour avec l'identifiant de la ligne", async () => {
    rendre([organisme({ id: "org-42" })]);
    fireEvent.click(screen.getByRole("button", { name: "Modifier CNSS/AMO" }));
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "CNSS/AMO 2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(modifier).toHaveBeenCalledWith("org-42", expect.objectContaining({ nom: "CNSS/AMO 2026" })),
    );
  });
});

describe("désactiver", () => {
  const interrupteur = () => screen.getByRole("switch", { hidden: true });

  it("demande confirmation et dit ce que ça change", () => {
    rendre([organisme()]);
    fireEvent.click(interrupteur());

    expect(screen.getByText("Désactiver cet organisme ?")).toBeTruthy();
    expect(screen.getByText(/ventes passées qui le référencent restent intactes/)).toBeTruthy();
    expect(basculer).not.toHaveBeenCalled();
  });

  it("ne bascule qu'après confirmation", async () => {
    rendre([organisme({ id: "org-7" })]);
    fireEvent.click(interrupteur());
    fireEvent.click(screen.getByRole("button", { name: "Désactiver" }));

    await waitFor(() => expect(basculer).toHaveBeenCalledWith("org-7", false));
  });

  it("ne bouge pas si l'on annule", () => {
    rendre([organisme()]);
    fireEvent.click(interrupteur());
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));

    expect(interrupteur().getAttribute("data-state")).toBe("checked");
    expect(basculer).not.toHaveBeenCalled();
  });

  it("propose de réactiver un organisme inactif", () => {
    rendre([organisme({ actif: false })]);
    expect(interrupteur().getAttribute("data-state")).toBe("unchecked");
    expect(screen.getByText("Inactif")).toBeTruthy();
    fireEvent.click(interrupteur());
    expect(screen.getByText("Réactiver cet organisme ?")).toBeTruthy();
  });
});
