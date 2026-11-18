import { describe, expect, it } from "vitest";
import { stockEntrySchema } from "@/lib/validations/stock-entry";

/**
 * The short form's contract. Its whole point is what it does *not* ask
 * for: everything the catalogue already holds. A field creeping back in
 * here means a pharmacist retypes a DCI that already exists nationally,
 * and the two copies start to drift.
 */
describe("formulaire réduit d'ajout au stock", () => {
  const minimal = { catalogueProduitId: "fiche-1" };

  it("n'accepte que les champs propres à l'officine", () => {
    const parsed = stockEntrySchema.parse(minimal);
    expect(Object.keys(parsed).sort()).toEqual([
      "catalogueProduitId",
      "localisation",
      "prixAchat",
      "quantiteInitiale",
      "referenceInterne",
      "seuilAlerte",
      "supplierId",
    ]);
  });

  it("ne demande rien de ce que le catalogue porte déjà", () => {
    const parsed = stockEntrySchema.parse({
      ...minimal,
      // Champs catalogue glissés dans la requête : ils doivent être ignorés,
      // pas repris — la pharmacie ne redéfinit pas le national.
      dci: "Paracétamol",
      ppv: 999,
      monographie: "texte",
      posologieAdulte: "3 par jour",
      remboursable: true,
    } as never);

    expect(parsed).not.toHaveProperty("dci");
    expect(parsed).not.toHaveProperty("ppv");
    expect(parsed).not.toHaveProperty("monographie");
    expect(parsed).not.toHaveProperty("posologieAdulte");
    expect(parsed).not.toHaveProperty("remboursable");
  });

  it("exige une fiche catalogue", () => {
    expect(stockEntrySchema.safeParse({ catalogueProduitId: "" }).success).toBe(false);
    expect(stockEntrySchema.safeParse({}).success).toBe(false);
  });

  it("part de zéro plutôt que d'inventer un stock", () => {
    const parsed = stockEntrySchema.parse(minimal);
    expect(parsed.quantiteInitiale).toBe(0);
    expect(parsed.seuilAlerte).toBe(0);
  });

  it("accepte une officine sans fournisseur choisi", () => {
    expect(stockEntrySchema.parse(minimal).supplierId).toBeNull();
    expect(stockEntrySchema.parse({ ...minimal, supplierId: "  " }).supplierId).toBeNull();
    expect(stockEntrySchema.parse({ ...minimal, supplierId: "f-1" }).supplierId).toBe("f-1");
  });

  it("refuse les quantités absurdes", () => {
    expect(stockEntrySchema.safeParse({ ...minimal, quantiteInitiale: -1 }).success).toBe(false);
    expect(stockEntrySchema.safeParse({ ...minimal, quantiteInitiale: 2.5 }).success).toBe(false);
    expect(stockEntrySchema.safeParse({ ...minimal, seuilAlerte: -3 }).success).toBe(false);
    expect(stockEntrySchema.safeParse({ ...minimal, prixAchat: -1 }).success).toBe(false);
  });

  it("traite un champ vide comme absent, pas comme zéro", () => {
    const parsed = stockEntrySchema.parse({
      ...minimal,
      prixAchat: "",
      referenceInterne: "",
      localisation: "   ",
    });
    expect(parsed.prixAchat).toBeNull();
    expect(parsed.referenceInterne).toBeNull();
    expect(parsed.localisation).toBeNull();
  });

  it("lit les nombres saisis comme texte par les <input>", () => {
    const parsed = stockEntrySchema.parse({
      ...minimal,
      quantiteInitiale: "12",
      seuilAlerte: "3",
      prixAchat: "20.5",
    });
    expect(parsed.quantiteInitiale).toBe(12);
    expect(parsed.seuilAlerte).toBe(3);
    expect(parsed.prixAchat).toBe(20.5);
  });
});
