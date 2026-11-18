import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La journalisation des exports de documents.
 *
 * Quatre routes téléchargent un PDF — facture, bordereau, bon de
 * commande, bon de livraison — et chacune doit laisser une trace disant
 * **quoi** et **par qui**. C'est le geste par lequel des données sortent
 * de l'application, donc celui qu'un contrôle vient regarder en premier.
 */

const state = vi.hoisted(() => ({ journal: [] as Record<string, unknown>[] }));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    eventLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.journal.push({ ...data });
        return data;
      },
    },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({
    id: "user-1",
    email: "titulaire@akribis.test",
    name: "Titulaire",
    role: "owner",
    pharmacyId: "pharmacy-1",
  }),
}));

const { journaliserTelechargement } = await import("@/lib/audit/export-document");
const { ENTITES } = await import("@/lib/audit/event-log");

beforeEach(() => {
  state.journal = [];
});

const derniere = () => state.journal.at(-1)!;

describe("trace d'un téléchargement", () => {
  it("dit quel document, et qui l'a sorti", async () => {
    await journaliserTelechargement({
      entite: ENTITES.facture,
      entiteId: "inv-1",
      nom: "FACT-2026-0003",
    });

    expect(state.journal).toHaveLength(1);
    expect(derniere().typeAction).toBe("document.exporte");
    expect(derniere().entite).toBe("facture");
    expect(derniere().entiteId).toBe("inv-1");
    expect(derniere().acteurEmail).toBe("titulaire@akribis.test");
    expect(derniere().pharmacyId).toBe("pharmacy-1");
    // Le numéro affiché, pour que le journal se lise sans jointure vers
    // une facture qui pourrait avoir changé depuis.
    expect(derniere().apres).toEqual({ nom: "FACT-2026-0003", format: "PDF" });
  });

  it("n'archive aucun avant/après : un export ne change rien", async () => {
    await journaliserTelechargement({
      entite: ENTITES.bordereau,
      entiteId: "bor-1",
      nom: "BOR-2026-0001",
    });
    expect(derniere().avant).toBeUndefined();
  });

  it("distingue les quatre natures de document", async () => {
    // Sans cette distinction, filtrer « qui a exporté des factures »
    // remonterait aussi les bons de commande.
    for (const [entite, nom] of [
      [ENTITES.facture, "FACT-2026-0001"],
      [ENTITES.bordereau, "BOR-2026-0001"],
      [ENTITES.bonCommande, "CMD-0001"],
      [ENTITES.bonLivraison, "BL-0001"],
    ] as const) {
      await journaliserTelechargement({ entite, entiteId: `${entite}-1`, nom });
    }

    expect(state.journal.map((e) => e.entite)).toEqual([
      "facture",
      "bordereau",
      "bon_commande",
      "bon_livraison",
    ]);
  });
});

/**
 * Les quatre routes, vérifiées sur leur source.
 *
 * Les exécuter demanderait de monter quatre façades, leurs données et
 * leur rendu PDF pour observer un appel d'une ligne. Ce que ces
 * assertions verrouillent, c'est l'**ordre** : la trace vient après le
 * contrôle d'existence, sans quoi un identifiant au hasard fabriquerait
 * l'entrée d'un export qui n'a pas eu lieu — et avant le rendu, pour
 * qu'un PDF ne parte jamais sans sa trace.
 */
describe("les quatre routes de téléchargement", () => {
  const ROUTES = [
    ["factures", "app/(dashboard)/factures/[id]/pdf/route.ts", "renderInvoicePdf"],
    ["bordereaux", "app/(dashboard)/bordereaux/[id]/pdf/route.ts", "renderBordereauPdf"],
    ["bons de commande", "app/(dashboard)/commandes/[id]/pdf/route.ts", "renderPurchaseOrderPdf"],
    [
      "bons de livraison",
      "app/(dashboard)/commandes/[id]/livraisons/[deliveryId]/pdf/route.ts",
      "renderDeliveryNotePdf",
    ],
  ] as const;

  it.each(ROUTES)("%s : journalise entre le contrôle et le rendu", (_nom, chemin, rendu) => {
    const source = readFileSync(resolve(__dirname, "../..", chemin), "utf8");

    const controle = source.indexOf("status: 404");
    const trace = source.indexOf("journaliserTelechargement", source.indexOf("export async function GET"));
    const rendus = source.indexOf(rendu, source.indexOf("export async function GET"));

    expect(controle, "pas de contrôle d'existence").toBeGreaterThan(-1);
    expect(trace, "aucune journalisation dans le gestionnaire").toBeGreaterThan(-1);
    expect(trace, "la trace précède le contrôle d'existence").toBeGreaterThan(controle);
    expect(trace, "la trace suit le rendu du PDF").toBeLessThan(rendus);
  });
});
