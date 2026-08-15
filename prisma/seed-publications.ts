/**
 * Seeds the Akribis actualités feed with realistic editorial content, so
 * the page can be exercised against something other than an empty state.
 *
 * Run with:
 *   npm run seed:publications
 *   npm run seed:publications -- --dry-run   (prints, writes nothing)
 *
 * Deliberately does NOT touch `publication_lectures`: every publication
 * stays unread for every user, which is what makes the unread ring and
 * the sidebar counter testable.
 *
 * Safe to re-run. Each row carries a fixed id and is written with
 * INSERT ... ON CONFLICT DO UPDATE, so a second run refreshes the
 * existing rows (including their publication dates, which are relative to
 * when the script runs) instead of inserting duplicates. Existing
 * read-state survives, since the ids the lectures point at don't change.
 *
 * Why `pg` and raw SQL rather than the Prisma client: this runs on plain
 * Node, which strips TypeScript types natively but resolves ESM strictly.
 * The generated Prisma client imports its own modules without file
 * extensions (fine for the Next bundler, unresolvable for Node), so
 * importing it here would need an extra loader dependency like tsx. `pg`
 * is already a direct dependency and needs none.
 */

import "dotenv/config";
import { Client } from "pg";
// Explicit .ts extension: this file runs on plain Node, which resolves ESM
// strictly and will not guess it.
import { assertSafeSeedTarget } from "./seed-guard.ts";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const now = Date.now();
const hoursAgo = (hours: number) => new Date(now - hours * HOUR_MS);
const daysAgo = (days: number) => new Date(now - days * DAY_MS);

/** Mirrors the Prisma enums; Postgres re-validates these on insert via the ::casts below. */
type PublicationType = "nouveaute" | "alerte" | "maintenance" | "annonce_suite";
type NiveauUrgence = "faible" | "moyenne" | "elevee";
type OutilAkribis = "intelligence" | "labo" | "medical" | "suite";

type SeedPublication = {
  id: string;
  titre: string;
  contenu: string;
  type: PublicationType;
  niveauUrgence?: NiveauUrgence;
  outilAssocie?: OutilAkribis;
  datePublication: Date;
};

/**
 * Fixed ids (not random UUIDs) are what make re-runs idempotent — see the
 * note above. `auteur` is intentionally never set, so the column default
 * ("Équipe Akribis") applies.
 */
const PUBLICATIONS: SeedPublication[] = [
  {
    id: "11111111-0000-4000-8000-000000000001",
    type: "nouveaute",
    titre: "La facturation est maintenant disponible",
    contenu:
      "Générez des factures conformes directement depuis vos ventes, avec numérotation automatique.",
    datePublication: hoursAgo(3),
  },
  {
    id: "11111111-0000-4000-8000-000000000002",
    type: "alerte",
    niveauUrgence: "elevee",
    titre: "Rappel de lot — Ministère de la Santé",
    contenu:
      "Un lot du produit Amoxicilline 500mg (lot AX2394) fait l'objet d'un rappel. Vérifiez votre stock.",
    datePublication: hoursAgo(5),
  },
  {
    id: "11111111-0000-4000-8000-000000000003",
    type: "maintenance",
    titre: "Maintenance planifiée ce dimanche",
    contenu: "Akribis sera indisponible de 2h à 4h du matin pour une mise à jour technique.",
    datePublication: hoursAgo(7),
  },
  {
    id: "11111111-0000-4000-8000-000000000004",
    type: "annonce_suite",
    outilAssocie: "intelligence",
    titre: "Akribis Intelligence est en bêta",
    contenu:
      "Analysez vos ventes et anticipez vos réassorts grâce à l'IA. Rejoignez la liste d'attente.",
    datePublication: daysAgo(1),
  },
  {
    id: "11111111-0000-4000-8000-000000000005",
    type: "nouveaute",
    titre: "Nouveau module Inventaire",
    contenu: "Comptez votre stock physique et ajustez les écarts en un clic.",
    datePublication: daysAgo(2),
  },
  {
    id: "11111111-0000-4000-8000-000000000006",
    type: "alerte",
    niveauUrgence: "moyenne",
    titre: "Mise à jour de la liste des produits remboursables",
    contenu: "La CNOPS a actualisé sa liste de remboursement pour ce mois-ci.",
    datePublication: daysAgo(3),
  },
  {
    id: "11111111-0000-4000-8000-000000000007",
    type: "nouveaute",
    titre: "Recherche améliorée sur les produits",
    contenu: "Trouvez un produit par nom, code-barres ou DCI en une seule recherche.",
    datePublication: daysAgo(4),
  },
  {
    id: "11111111-0000-4000-8000-000000000008",
    type: "maintenance",
    titre: "Amélioration de la synchronisation hors ligne",
    contenu:
      "La synchronisation des ventes après une coupure internet est désormais plus rapide.",
    datePublication: daysAgo(5),
  },
  {
    id: "11111111-0000-4000-8000-000000000009",
    type: "alerte",
    niveauUrgence: "moyenne",
    titre: "Nouvelle réglementation sur les psychotropes",
    contenu: "De nouvelles règles de traçabilité entrent en vigueur le 1er septembre.",
    datePublication: daysAgo(6),
  },
  {
    id: "11111111-0000-4000-8000-000000000010",
    type: "annonce_suite",
    outilAssocie: "suite",
    titre: "Akribis Suite : gérez tous vos outils en un seul endroit",
    contenu:
      "Retrouvez votre abonnement, vos factures et vos accès à tous les produits Akribis.",
    datePublication: daysAgo(7),
  },
];

/**
 * `updated_at` is set explicitly: Prisma's @updatedAt is applied by the
 * client, not by a database default, so the column is NOT NULL with no
 * DEFAULT and raw SQL has to provide it.
 */
const UPSERT_SQL = `
  INSERT INTO publications
    (id, titre, contenu, type, niveau_urgence, outil_associe, date_publication, updated_at)
  VALUES
    ($1, $2, $3, $4::publication_type, $5::niveau_urgence, $6::outil_akribis, $7, NOW())
  ON CONFLICT (id) DO UPDATE SET
    titre = EXCLUDED.titre,
    contenu = EXCLUDED.contenu,
    type = EXCLUDED.type,
    niveau_urgence = EXCLUDED.niveau_urgence,
    outil_associe = EXCLUDED.outil_associe,
    date_publication = EXCLUDED.date_publication,
    updated_at = NOW()
`;

function printDryRun() {
  console.log(`[dry-run] ${PUBLICATIONS.length} publications seraient écrites :\n`);
  for (const publication of PUBLICATIONS) {
    const details = [
      publication.niveauUrgence && `urgence=${publication.niveauUrgence}`,
      publication.outilAssocie && `outil=${publication.outilAssocie}`,
    ]
      .filter(Boolean)
      .join(" ");
    console.log(
      `  ${publication.datePublication.toISOString()}  ${publication.type.padEnd(13)} ${details.padEnd(22)} ${publication.titre}`,
    );
  }
  console.log("\n[dry-run] Aucune écriture effectuée, aucune connexion ouverte.");
}

async function main() {
  if (process.argv.includes("--dry-run")) {
    printDryRun();
    return;
  }

  // Before opening a connection, never after: the point is to refuse a
  // write to an unlabelled or production database, not to report it once
  // the rows are already gone. `--dry-run` above returns earlier still —
  // printing what would be written touches nothing.
  assertSafeSeedTarget();

  const connectionString = process.env.DATABASE_URL!;
  const client = new Client({ connectionString });
  await client.connect();

  try {
    for (const publication of PUBLICATIONS) {
      await client.query(UPSERT_SQL, [
        publication.id,
        publication.titre,
        publication.contenu,
        publication.type,
        publication.niveauUrgence ?? null,
        publication.outilAssocie ?? null,
        publication.datePublication,
      ]);
    }

    const { rows } = await client.query<{ publications: string; lectures: string }>(
      "SELECT (SELECT COUNT(*) FROM publications) AS publications, (SELECT COUNT(*) FROM publication_lectures) AS lectures",
    );
    console.log(
      `${PUBLICATIONS.length} publications écrites. Total en base : ${rows[0]?.publications}. ` +
        `Lignes de lecture : ${rows[0]?.lectures} (le seed n'en crée aucune).`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Échec du seed des publications :", error);
  process.exitCode = 1;
});
