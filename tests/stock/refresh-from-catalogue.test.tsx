import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { RefreshFromCatalogueButton } from "@/components/features/stock/refresh-from-catalogue-button";
import type { RefreshResult } from "@/lib/server/stock-entry";

// Typé sur l'union, sinon le mock se fige sur la branche succès et le
// cas d'erreur ne compile plus.
const refresh = vi.fn<() => Promise<RefreshResult>>(async () => ({
  ok: true,
  champsModifies: 3,
}));
vi.mock("@/lib/server/stock-entry", () => ({
  refreshFromCatalogue: (...args: unknown[]) => refresh(...(args as [])),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

beforeEach(() => refresh.mockClear());

/**
 * Ce bouton écrase le travail de la pharmacie sur les champs produit. Les
 * deux garanties qui comptent : il ne part jamais tout seul, et il annonce
 * précisément ce qui survit.
 */
describe("mise à jour depuis le catalogue", () => {
  it("ne réimporte rien sans confirmation explicite", () => {
    render(<RefreshFromCatalogueButton productId="p1" />);

    fireEvent.click(screen.getByRole("button", { name: /Mettre à jour depuis le catalogue/ }));
    expect(refresh).not.toHaveBeenCalled();

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/seront perdues/i)).toBeInTheDocument();
  });

  it("annuler ne déclenche aucun réimport", () => {
    render(<RefreshFromCatalogueButton productId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /Mettre à jour depuis le catalogue/ }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Annuler" }),
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("dit ce qui ne bouge pas — les faits de l'officine", () => {
    render(<RefreshFromCatalogueButton productId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /Mettre à jour depuis le catalogue/ }));

    const texte = screen.getByRole("alertdialog").textContent ?? "";
    for (const mot of ["quantité", "seuil", "prix d'achat", "emplacement", "référence interne", "fournisseur"]) {
      expect(texte.toLowerCase()).toContain(mot.toLowerCase());
    }
  });

  it("réimporte après confirmation, et rend compte du nombre de champs", async () => {
    render(<RefreshFromCatalogueButton productId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /Mettre à jour depuis le catalogue/ }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Réimporter" }),
    );

    expect(refresh).toHaveBeenCalledWith("p1");
    expect(await screen.findByText(/3 champs mis à jour/)).toBeInTheDocument();
  });

  it("le dit franchement quand rien n'a changé", async () => {
    refresh.mockResolvedValueOnce({ ok: true, champsModifies: 0 });
    render(<RefreshFromCatalogueButton productId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /Mettre à jour depuis le catalogue/ }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Réimporter" }),
    );
    expect(await screen.findByText(/déjà identique au catalogue/)).toBeInTheDocument();
  });

  it("remonte l'erreur du serveur", async () => {
    refresh.mockResolvedValueOnce({ ok: false, error: "La fiche catalogue d'origine n'existe plus." });
    render(<RefreshFromCatalogueButton productId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /Mettre à jour depuis le catalogue/ }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Réimporter" }),
    );
    expect(await screen.findByText(/n'existe plus/)).toBeInTheDocument();
  });
});
