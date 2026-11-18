import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderAvecProviders } from "@/tests/fixtures/render-avec-providers";
import { JournalTable } from "@/components/features/admin/journal-table";
import { champsModifies, libelleAction, TYPES_ACTION } from "@/lib/audit/event-log";
import type { EventLogRecord } from "@/lib/server/audit";

/**
 * La page Admin du journal d'audit.
 *
 * Elle n'existe que pour répondre à « qui a fait quoi, et qu'est-ce que ça
 * a changé ». Les deux moitiés de la question sont testées ici : la liste
 * pour la première, le détail pour la seconde.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

function entree(overrides: Partial<EventLogRecord> = {}): EventLogRecord {
  return {
    id: "e1",
    acteurEmail: "admin@akribis.test",
    acteurRole: "admin_akribis",
    typeAction: TYPES_ACTION.catalogueProduitModifie,
    entite: "catalogue_produit",
    entiteId: "8f3c1a2e-0000-4000-8000-000000000000",
    cible: "DOLIPRANE 500 mg",
    avant: { nom: "DOLIPRANE 500 mg", ppv: "18.5", updatedAt: "2026-08-01T00:00:00.000Z" },
    apres: { nom: "DOLIPRANE 500 mg", ppv: "21.9", updatedAt: "2026-08-21T00:00:00.000Z" },
    createdAt: new Date("2026-08-21T09:30:00.000Z"),
    ...overrides,
  };
}

const rendre = (entrees: EventLogRecord[]) =>
  renderAvecProviders(<JournalTable entrees={entrees} />);

describe("la liste", () => {
  it("dit quand, quoi, sur quelle fiche et par qui", () => {
    rendre([entree()]);
    const ligne = screen.getByText("DOLIPRANE 500 mg").closest("tr")!;
    expect(within(ligne).getByText("Fiche modifiée")).toBeTruthy();
    expect(within(ligne).getByText("admin@akribis.test")).toBeTruthy();
    expect(within(ligne).getByText("admin_akribis")).toBeTruthy();
    expect(within(ligne).getByText(/21\/08\/2026/)).toBeTruthy();
  });

  it("nomme chaque type d'action en clair", () => {
    expect(libelleAction(TYPES_ACTION.catalogueProduitCree)).toBe("Fiche créée");
    expect(libelleAction(TYPES_ACTION.catalogueProduitDesactive)).toBe("Fiche désactivée");
    expect(libelleAction(TYPES_ACTION.catalogueProduitReactive)).toBe("Fiche réactivée");
  });

  it("laisse lisible une action inconnue plutôt que de l'effacer", () => {
    // Une entrée écrite par une version plus récente que cet écran.
    rendre([entree({ typeAction: "catalogue.produit.fusionnee" })]);
    expect(screen.getByText("catalogue.produit.fusionnee")).toBeTruthy();
  });

  it("le dit quand la fiche visée n'existe plus", () => {
    rendre([entree({ cible: null })]);
    expect(screen.getByText("(fiche supprimée)")).toBeTruthy();
    // L'identifiant reste affiché : c'est tout ce qui rattache l'entrée.
    expect(screen.getByText("8f3c1a2e-0000-4000-8000-000000000000")).toBeTruthy();
  });

  it("n'offre aucune sélection — rien ne se supprime dans un journal", () => {
    rendre([entree()]);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("accueille un journal vide sans faire croire à une panne", () => {
    rendre([]);
    expect(screen.getByText("Aucune action enregistrée")).toBeTruthy();
  });
});

describe("le détail", () => {
  it("ne montre que ce qui a changé", () => {
    rendre([entree()]);
    fireEvent.click(screen.getByRole("button", { name: "Détail" }));

    const dialogue = screen.getByRole("dialog");
    expect(within(dialogue).getByText("ppv")).toBeTruthy();
    expect(within(dialogue).getByText("18.5")).toBeTruthy();
    expect(within(dialogue).getByText("21.9")).toBeTruthy();
    // `nom` n'a pas bougé : l'afficher noierait le seul champ qui compte.
    expect(within(dialogue).queryByText("nom")).toBeNull();
  });

  it("écarte les horodatages, qui changent à chaque écriture", () => {
    rendre([entree()]);
    fireEvent.click(screen.getByRole("button", { name: "Détail" }));
    expect(within(screen.getByRole("dialog")).queryByText("updatedAt")).toBeNull();
  });

  it("le dit franchement quand rien n'a changé", () => {
    const inchangee = entree({ avant: { nom: "X" }, apres: { nom: "X" } });
    rendre([inchangee]);
    fireEvent.click(screen.getByRole("button", { name: "Détail" }));
    expect(screen.getByText(/Aucun champ n'a changé/)).toBeTruthy();
  });

  it("rend les booléens lisibles plutôt que « true »", () => {
    const bascule = entree({
      typeAction: TYPES_ACTION.catalogueProduitDesactive,
      avant: { actifCatalogue: true },
      apres: { actifCatalogue: false },
    });
    rendre([bascule]);
    fireEvent.click(screen.getByRole("button", { name: "Détail" }));

    const dialogue = screen.getByRole("dialog");
    expect(within(dialogue).getByText("oui")).toBeTruthy();
    expect(within(dialogue).getByText("non")).toBeTruthy();
  });
});

describe("le calcul des champs modifiés", () => {
  it("ne retient que les différences", () => {
    const diff = champsModifies({ a: 1, b: 2 }, { a: 1, b: 3 });
    expect(diff).toEqual([{ champ: "b", avant: 2, apres: 3 }]);
  });

  it("voit un champ apparu et un champ disparu", () => {
    expect(champsModifies({ a: 1 }, { a: 1, b: 2 }).map((d) => d.champ)).toEqual(["b"]);
    expect(champsModifies({ a: 1, b: 2 }, { a: 1 }).map((d) => d.champ)).toEqual(["b"]);
  });

  it("traite une création, où il n'y a pas d'avant", () => {
    expect(champsModifies(null, { nom: "X" })).toEqual([
      { champ: "nom", avant: undefined, apres: "X" },
    ]);
  });

  it("ne se laisse pas piéger par l'ordre des clés d'un objet imbriqué", () => {
    // JSON.stringify est sensible à l'ordre : deux objets équivalents mais
    // sérialisés différemment se signaleraient comme un changement.
    const diff = champsModifies({ o: { a: 1, b: 2 } }, { o: { a: 1, b: 2 } });
    expect(diff).toEqual([]);
  });
});
