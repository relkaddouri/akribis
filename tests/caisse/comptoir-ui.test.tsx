import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderAvecProviders } from "@/tests/fixtures/render-avec-providers";
import { CaisseBarre } from "@/components/features/caisse/caisse-barre";
import type { ResumeSession } from "@/lib/server/caisse";

/**
 * Le comptoir, côté écran.
 *
 * Deux choses sont verrouillées ici, et ce sont les deux qu'un remaniement
 * casserait sans le vouloir : la bande de session ne révèle **pas** les
 * espèces — sans quoi le comptage de clôture cesserait d'être à l'aveugle —
 * et le comptoir reste rendu derrière la fenêtre d'ouverture, inerte, plutôt
 * que remplacé par une page d'attente.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

function resume(surcharges: Partial<ResumeSession> = {}): ResumeSession {
  return {
    sessionId: "sess-1",
    dateOuverture: new Date(2026, 7, 23, 8, 12),
    ouvreurNom: "Salma",
    nombreVentes: 7,
    caTtc: 1456.4,
    ...surcharges,
  };
}

describe("la bande de session", () => {
  it("montre la journée en cours d'un coup d'œil", () => {
    renderAvecProviders(
      <CaisseBarre resume={resume()} onCloturer={() => {}} clotureDisponible />,
    );

    expect(screen.getByText("Caisse ouverte")).toBeInTheDocument();
    expect(screen.getByText(/depuis 08:12 · Salma/)).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText(/1[\s  ]456,40/)).toBeInTheDocument();
  });

  it("ne révèle jamais les espèces du tiroir", () => {
    /*
     * Le point qui compte. Le comptage de clôture se fait à l'aveugle :
     * afficher toute la journée le montant que le tiroir devrait contenir
     * reviendrait à compter en sachant quoi trouver. Le nombre de ventes
     * et le CA renseignent sans donner la réponse.
     */
    const { container } = renderAvecProviders(
      <CaisseBarre resume={resume()} onCloturer={() => {}} clotureDisponible />,
    );

    const texte = container.textContent!;
    expect(texte).not.toMatch(/esp[èe]ces/i);
    expect(texte).not.toMatch(/th[ée]orique/i);
    expect(texte).not.toMatch(/tiroir/i);
    expect(texte).not.toMatch(/fond de caisse/i);
  });

  it("ouvre la clôture sans quitter le comptoir", () => {
    // Le geste du soir doit être à portée : renvoyer vers un autre module
    // pour fermer sa caisse ferait perdre l'écran où l'on travaille.
    const cloturer = vi.fn();
    renderAvecProviders(
      <CaisseBarre resume={resume()} onCloturer={cloturer} clotureDisponible />,
    );

    fireEvent.click(screen.getByRole("button", { name: /clôturer la caisse/i }));
    expect(cloturer).toHaveBeenCalledTimes(1);
  });

  it("dit pourquoi quand la clôture n'est pas permise", () => {
    // Un bouton absent sans explication se lit comme une panne.
    renderAvecProviders(
      <CaisseBarre
        resume={resume()}
        onCloturer={() => {}}
        clotureDisponible={false}
        raisonIndisponible="La clôture de caisse est réservée au titulaire."
      />,
    );

    expect(screen.queryByRole("button", { name: /clôturer/i })).toBeNull();
    expect(screen.getByText(/réservée au titulaire/)).toBeInTheDocument();
  });

  it("n'affiche pas d'heure avant le montage, pour ne pas mentir d'un battement", () => {
    // Rendue côté serveur, l'horloge afficherait l'heure du serveur que
    // React remplacerait aussitôt : une discordance d'hydratation, et une
    // heure fausse le temps d'un rendu. Elle démarre donc vide.
    const source = readFileSync(
      resolve(__dirname, "../..", "components/features/caisse/caisse-barre.tsx"),
      "utf8",
    );
    expect(source).toMatch(/useState<Date \| null>\(null\)/);
    expect(source).toMatch(/"--:--"/);
  });
});

/**
 * Le floutage, vérifié sur la source : monter `PosView` demanderait la
 * couche hors ligne entière (Dexie, file de synchronisation), qu'aucun
 * test du dépôt ne monte.
 */
describe("le comptoir derrière la fenêtre d'ouverture", () => {
  const source = readFileSync(
    resolve(__dirname, "../..", "components/features/pos/pos-view.tsx"),
    "utf8",
  );

  it("reste rendu, flouté, au lieu d'être remplacé", () => {
    expect(source).toMatch(/blur-sm/);
    expect(source).toMatch(/!caisseOuverte &&/);
  });

  it("est rendu inerte, et pas seulement insensible au pointeur", () => {
    // `pointer-events-none` laisserait la tabulation parcourir un panier
    // invisible et le lecteur d'écran l'annoncer. `inert` coupe les trois.
    expect(source).toMatch(/inert=\{!caisseOuverte\}/);
  });

  it("ouvre la fenêtre d'ouverture dès qu'aucune session n'est ouverte", () => {
    // `[\s\S]` plutôt qu'un motif sur une ligne : l'appel s'étale sur
    // plusieurs lignes depuis qu'il porte le repli hors ligne, et une
    // assertion collée au formatage casse sans qu'aucune logique ne bouge.
    expect(source).toMatch(/!caisseOuverte && \([\s\S]{0,80}<DialogueOuverture/);
  });

  it("bascule sur une ouverture locale quand le serveur ne répond pas", () => {
    // Le comptoir doit pouvoir ouvrir sans réseau : refuser laisserait
    // l'officine bloquée pour la journée.
    expect(source).toMatch(/onOuvrirLocalement=/);
    const dialogues = readFileSync(
      resolve(__dirname, "../..", "components/features/caisse/caisse-dialogues.tsx"),
      "utf8",
    );
    expect(dialogues).toMatch(/catch \{[\s\S]{0,600}onOuvrirLocalement\(Number\(fond\)\)/);
  });

  it("porte la clôture depuis le comptoir lui-même", () => {
    expect(source).toMatch(/<DialogueCloture/);
    expect(source).toMatch(/onCloturer=\{\(\) => setClotureOuverte\(true\)\}/);
  });
});
