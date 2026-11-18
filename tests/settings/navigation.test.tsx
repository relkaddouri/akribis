import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Building2, ShieldCheck } from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { SettingsNav } from "@/components/features/settings/settings-nav";

/**
 * La navigation des Paramètres, passée d'une barre d'onglets horizontale à
 * une colonne.
 *
 * Ce qui doit survivre au changement d'apparence : le déplacement au
 * clavier, le rattachement ARIA entre chaque entrée et son panneau, et le
 * fait qu'une entrée sans panneau — ou l'inverse — se remarque.
 */

const SECTIONS = [
  { value: "informations", label: "Informations", icon: <Building2 /> },
  { value: "tiers-payant", label: "Tiers payant", icon: <ShieldCheck /> },
];

function rendre() {
  return render(
    <Tabs defaultValue="informations" orientation="vertical">
      <SettingsNav sections={SECTIONS} />
      <TabsContent value="informations">Informations de la pharmacie</TabsContent>
      <TabsContent value="tiers-payant">Organismes tiers payant</TabsContent>
    </Tabs>,
  );
}

function ouvrir(nom: string) {
  const onglet = screen.getByRole("tab", { name: nom });
  fireEvent.mouseDown(onglet);
  fireEvent.focus(onglet);
  fireEvent.click(onglet);
  return onglet;
}

describe("la colonne de navigation", () => {
  it("reste une vraie liste d'onglets, pas de simples boutons", () => {
    rendre();
    // C'est ce qui porte le déplacement au clavier et le lien vers le
    // panneau : le remplacer par des <button> les perdrait en silence.
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("s'annonce verticale aux technologies d'assistance", () => {
    rendre();
    expect(screen.getByRole("tablist").getAttribute("aria-orientation")).toBe("vertical");
  });

  it("change de panneau", () => {
    rendre();
    expect(screen.getByRole("tabpanel").textContent).toContain("Informations de la pharmacie");
    ouvrir("Tiers payant");
    expect(screen.getByRole("tabpanel").textContent).toContain("Organismes tiers payant");
  });

  it("marque la section ouverte", () => {
    rendre();
    expect(screen.getByRole("tab", { name: "Informations" }).getAttribute("data-state")).toBe(
      "active",
    );
    ouvrir("Tiers payant");
    expect(screen.getByRole("tab", { name: "Tiers payant" }).getAttribute("data-state")).toBe(
      "active",
    );
  });

  it("relie chaque entrée à son panneau", () => {
    rendre();
    const onglet = screen.getByRole("tab", { name: "Informations" });
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(onglet.id);
  });
});

/**
 * La page déclare ses sections dans un tableau et ses panneaux en JSX :
 * les deux peuvent diverger sans que rien ne le signale — une entrée qui
 * n'ouvre rien, ou un panneau qu'aucune entrée n'atteint.
 */
describe("les sections et les panneaux se correspondent", () => {
  it("chaque entrée a son panneau, et réciproquement", () => {
    const source = readFileSync(
      resolve(__dirname, "../..", "app/(dashboard)/parametres/page.tsx"),
      "utf8",
    );

    const declarees = [...source.matchAll(/\{ value: "([^"]+)", label:/g)].map((m) => m[1]!);
    const panneaux = [...source.matchAll(/<TabsContent value="([^"]+)"/g)].map((m) => m[1]!);

    expect(declarees.length).toBeGreaterThan(3);
    expect([...declarees].sort()).toEqual([...panneaux].sort());
  });
});
