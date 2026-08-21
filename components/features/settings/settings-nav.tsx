"use client";

import { cn } from "@/lib/utils";
import { itemBaseClass } from "@/components/ui/app-sidebar";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * La navigation des Paramètres, en colonne plutôt qu'en barre d'onglets.
 *
 * Les sections ne sont pas des vues d'une même chose — informations,
 * ticket, tiers payant, utilisateurs, hors ligne n'ont rien en commun — et
 * une barre horizontale les présentait comme si elles l'étaient, tout en
 * laissant le contenu démarrer très bas. En colonne, chaque section porte
 * son icône, se lit d'un coup d'œil, et le contenu occupe la place.
 *
 * Reste bâti sur `Tabs` : Radix apporte le déplacement au clavier, le
 * rattachement ARIA entre l'onglet et son panneau, et l'état actif. Seule
 * l'apparence change.
 *
 * `itemBaseClass` est celle de la barre latérale principale : les deux
 * navigations de l'application ont ainsi la même hauteur de ligne, le même
 * écart icône-libellé et le même arrondi.
 */

export type SectionParametres = {
  value: string;
  label: string;
  icon: React.ReactNode;
};

export function SettingsNav({ sections }: { sections: SectionParametres[] }) {
  return (
    <TabsList
      variant="line"
      // `h-auto` et `w-full` : la variante par défaut est une barre compacte
      // de 32 px, taillée pour des onglets et non pour une colonne.
      className="h-auto w-full gap-0.5 p-0"
    >
      {sections.map((section) => (
        <TabsTrigger
          key={section.value}
          value={section.value}
          className={cn(
            itemBaseClass,
            "w-full justify-start px-sp-sm text-muted-foreground",
            "hover:bg-muted/60 hover:text-foreground",
            // L'émeraude de l'application pour la section ouverte. La barre
            // latérale principale se contente d'un gris : elle est toujours
            // à l'écran, celle-ci ne l'est que sur cette page, et c'est ici
            // qu'on a besoin de savoir où l'on est.
            "data-active:bg-primary/10 data-active:text-primary data-active:font-medium",
            // La variante `line` pose un trait vertical à droite de l'onglet
            // actif ; il ferait doublon avec la pastille teintée.
            "after:hidden",
          )}
        >
          {section.icon}
          {section.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
