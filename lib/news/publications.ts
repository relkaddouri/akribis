/**
 * Pure logic for the "Akribis actualités" feed — framework- and
 * data-layer-agnostic, same split as lib/stock/alerts.ts. The server
 * facade (lib/server/publications.ts) fetches rows; everything about
 * *which* publications to show and *how many* are still unread lives
 * here so it can be tested without a database.
 */

export const PUBLICATION_TYPES = [
  "nouveaute",
  "alerte",
  "maintenance",
  "annonce_suite",
] as const;
export type PublicationTypeValue = (typeof PUBLICATION_TYPES)[number];

export const URGENCE_NIVEAUX = ["faible", "moyenne", "elevee"] as const;
export type NiveauUrgenceValue = (typeof URGENCE_NIVEAUX)[number];

export const OUTILS_AKRIBIS = ["intelligence", "labo", "medical", "suite"] as const;
export type OutilAkribisValue = (typeof OUTILS_AKRIBIS)[number];

/** The shape the feed UI consumes — `lu` is derived per signed-in user. */
export type PublicationItem = {
  id: string;
  titre: string;
  contenu: string;
  type: PublicationTypeValue;
  niveauUrgence: NiveauUrgenceValue | null;
  outilAssocie: OutilAkribisValue | null;
  imageUrl: string | null;
  datePublication: Date;
  auteur: string;
  lu: boolean;
};

/** Filter tabs, in display order. `tous` is the catch-all. */
export const FEED_FILTERS = [
  { value: "tous", label: "Tous" },
  { value: "nouveaute", label: "Nouveautés" },
  { value: "alerte", label: "Alertes" },
  { value: "maintenance", label: "Maintenance" },
  { value: "annonce_suite", label: "Akribis Suite" },
] as const;

export type FeedFilter = (typeof FEED_FILTERS)[number]["value"];

/**
 * Publications matching `filter`, newest first. `tous` returns everything;
 * every other value matches the publication type of the same name.
 */
export function filterPublications<T extends Pick<PublicationItem, "type" | "datePublication">>(
  publications: T[],
  filter: FeedFilter,
): T[] {
  const matching =
    filter === "tous" ? [...publications] : publications.filter((p) => p.type === filter);
  return matching.sort((a, b) => b.datePublication.getTime() - a.datePublication.getTime());
}

/** How many publications the user still hasn't seen — drives the sidebar badge. */
export function countUnread(publications: Pick<PublicationItem, "lu">[]): number {
  return publications.filter((p) => !p.lu).length;
}

/**
 * French relative-time label ("Il y a 3 heures"). Kept here rather than
 * reaching for Intl.RelativeTimeFormat so the wording matches the rest of
 * the UI exactly, including the "À l'instant" floor.
 */
export function formatRelativeDate(date: Date, now: Date = new Date()): string {
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "À l'instant";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Il y a ${minutes} minute${minutes > 1 ? "s" : ""}`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours} heure${hours > 1 ? "s" : ""}`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `Il y a ${days} jour${days > 1 ? "s" : ""}`;

  const months = Math.floor(days / 30);
  if (months < 12) return `Il y a ${months} mois`;

  const years = Math.floor(months / 12);
  return `Il y a ${years} an${years > 1 ? "s" : ""}`;
}
