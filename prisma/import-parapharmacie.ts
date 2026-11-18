/**
 * Importe le catalogue parapharmaceutique (earthpara.ma) dans
 * `catalogue_produits`, photos comprises.
 *
 *   npm run import:para -- --source <dossier> --dry-run
 *   npm run import:para -- --source <dossier> --dry-run --limit 20
 *   npm run import:para -- --source <dossier> --limit 20
 *   npm run import:para -- --source <dossier>
 *
 * `<dossier>` est le `earthpara_final/` decompresse : il contient
 * `catalogue_parapharmaceutique.xlsx` et `photos/`.
 *
 * Rejouable. La cle de correspondance est (nom_produit, sous_categorie),
 * faute de code-barres dans la source -- voir `cleDe()` pour ses limites,
 * qui sont reelles.
 *
 * `pg` et SQL brut plutot que le client Prisma, comme les autres scripts
 * de ce dossier : Node nu ne resout pas les imports du client genere.
 */

import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { assertSafeSeedTarget } from "./seed-guard.ts";
import { parseXlsx } from "../lib/catalogue/spreadsheet.ts";
import { CATALOGUE_PHOTO_BUCKET } from "../lib/catalogue/photo-rules.ts";

const CLASSEUR = "catalogue_parapharmaceutique.xlsx";
const DOSSIER_PHOTOS = "photos";

/** Colonnes attendues dans le classeur. Absentes, le script refuse. */
const COLONNES = [
  "nom_produit",
  "categorie_principale",
  "sous_categorie",
  "sous_sous_categorie",
  "code_barres",
  "marque",
  "prix_vente_indicatif",
  "description",
  "etiquettes",
  "photo_fichier",
] as const;

type Colonne = (typeof COLONNES)[number];

/**
 * La cle de rapprochement, a defaut de code-barres : nom + sous-categorie,
 * insensible a la casse et aux espaces multiples.
 *
 * Sa limite est connue et mesuree : dans le fichier source, 469 cles
 * apparaissent plusieurs fois (702 lignes surnumeraires). Deux formats d'un
 * meme produit -- deux contenances, deux coloris -- portent souvent le meme
 * nom. Le script ne peut pas les distinguer : il n'en creera qu'un et
 * comptera les autres comme doublons. C'est le comportement voulu pour
 * rester rejouable ; c'est aussi la raison pour laquelle le rapport les
 * liste au lieu de les taire.
 */
function cleDe(nom: string, sousCategorie: string): string {
  const n = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();
  return `${n(nom)} ${n(sousCategorie)}`;
}

function nombreOuNull(brut: string): number | null {
  const t = brut.trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

const vide = (s: string) => (s.trim() ? s.trim() : null);

function argument(nom: string): string | undefined {
  const i = process.argv.indexOf(`--${nom}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

type Echec = { nom: string; fichier: string; raison: string };

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limite = Number(argument("limit") ?? 0) || 0;
  const source = argument("source");

  if (!source) {
    console.error(
      "\nDossier source manquant.\n\n" +
        "  unzip -q Akribis_Catalogue_Parapharmaceutique.zip -d /tmp/para\n" +
        "  npm run import:para -- --source /tmp/para/earthpara_final --dry-run\n",
    );
    process.exit(1);
  }

  const cheminClasseur = join(source, CLASSEUR);
  const cheminPhotos = join(source, DOSSIER_PHOTOS);
  if (!existsSync(cheminClasseur)) {
    console.error(`\nClasseur introuvable : ${cheminClasseur}\n`);
    process.exit(1);
  }

  // Refuse une base non etiquetee et affiche l'hote vise avant d'ecrire.
  assertSafeSeedTarget();

  const feuille = parseXlsx(readFileSync(cheminClasseur));
  const index = {} as Record<Colonne, number>;
  const absentes: string[] = [];
  for (const colonne of COLONNES) {
    const i = feuille.headers.indexOf(colonne);
    if (i === -1) absentes.push(colonne);
    index[colonne] = i;
  }
  if (absentes.length > 0) {
    console.error(`\nColonnes absentes du classeur : ${absentes.join(", ")}\n`);
    process.exit(1);
  }

  const lire = (ligne: string[], colonne: Colonne) => (ligne[index[colonne]] ?? "").trim();
  const lignes = limite > 0 ? feuille.rows.slice(0, limite) : feuille.rows;

  console.log(`Import parapharmacie -- ${cheminClasseur}`);
  console.log(`  lignes du classeur           ${feuille.rows.length}`);
  if (limite > 0) console.log(`  limitees a                   ${lignes.length}  (--limit)`);
  console.log(dryRun ? "  MODE                         dry-run, aucune ecriture\n" : "");

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!dryRun && (!supabaseUrl || !serviceKey)) {
    console.error("\nNEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.\n");
    process.exit(1);
  }
  const storage =
    !dryRun && supabaseUrl && serviceKey
      ? createClient(supabaseUrl, serviceKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        }).storage.from(CATALOGUE_PHOTO_BUCKET)
      : null;

  let crees = 0;
  let ignores = 0;
  let photosOk = 0;
  const photosEchouees: Echec[] = [];
  const doublons: { nom: string; sousCategorie: string }[] = [];

  try {
    // Les cles deja en base, chargees une fois : 7 895 requetes de
    // verification a l'unite couteraient plus que l'import lui-meme.
    const { rows: existantes } = await client.query<{ nom: string; sc: string | null }>(
      `SELECT "nom", "sous_categorie" AS sc FROM "catalogue_produits"`,
    );
    const connues = new Set(existantes.map((r) => cleDe(r.nom, r.sc ?? "")));
    console.log(`  fiches deja au catalogue     ${existantes.length}\n`);

    for (const ligne of lignes) {
      const nom = lire(ligne, "nom_produit");
      if (!nom) continue;

      const sousCategorie = lire(ligne, "sous_categorie");
      const cle = cleDe(nom, sousCategorie);

      // Le `Set` sert les deux cas d'un coup : deja en base, et deja vu
      // plus haut dans ce meme fichier.
      if (connues.has(cle)) {
        ignores += 1;
        if (doublons.length < 20) doublons.push({ nom, sousCategorie });
        continue;
      }
      connues.add(cle);

      const fichierPhoto = lire(ligne, "photo_fichier");
      const cheminPhoto = fichierPhoto ? join(cheminPhotos, fichierPhoto) : "";
      const photoDisponible = Boolean(fichierPhoto) && existsSync(cheminPhoto);
      if (fichierPhoto && !photoDisponible) {
        photosEchouees.push({ nom, fichier: fichierPhoto, raison: "fichier absent du dossier" });
      } else if (!fichierPhoto) {
        photosEchouees.push({ nom, fichier: "-", raison: "aucune photo referencee" });
      }

      if (dryRun) {
        crees += 1;
        if (photoDisponible) photosOk += 1;
        continue;
      }

      // Une transaction par produit : sur 7 895 lignes, une seule
      // transaction geante bloquerait la table et perdrait tout sur un
      // incident reseau au bout de vingt minutes.
      await client.query("BEGIN");
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO "catalogue_produits"
             ("id", "nom", "categorie", "forme_galenique", "code_barres",
              "marque", "categorie_principale", "sous_categorie", "sous_sous_categorie",
              "etiquettes", "prix_vente_indicatif", "description",
              "actif_catalogue", "produit_commercialise",
              "necessite_prescription", "refrigeration_requise", "remboursable",
              "produit_tableau", "created_at", "updated_at")
           VALUES (gen_random_uuid(), $1, 'parapharmaceutique', $2, $3,
                   $4, $5, $6, $7, $8, $9, $10,
                   true, true, false, false, false, 'aucun', now(), now())
           RETURNING "id"`,
          [
            nom,
            // `forme_galenique` est NOT NULL et n'a aucun sens ici : la
            // sous-categorie de rayon est ce qui s'en rapproche le plus.
            vide(lire(ligne, "sous_sous_categorie")) ?? vide(sousCategorie) ?? "Parapharmacie",
            vide(lire(ligne, "code_barres")),
            vide(lire(ligne, "marque")),
            vide(lire(ligne, "categorie_principale")),
            vide(sousCategorie),
            vide(lire(ligne, "sous_sous_categorie")),
            vide(lire(ligne, "etiquettes")),
            nombreOuNull(lire(ligne, "prix_vente_indicatif")),
            vide(lire(ligne, "description")),
          ],
        );
        const ficheId = rows[0]!.id;

        if (photoDisponible && storage) {
          const chemin = `${crypto.randomUUID()}.jpg`;
          const { error } = await storage.upload(chemin, readFileSync(cheminPhoto), {
            contentType: "image/jpeg",
          });
          if (error) {
            photosEchouees.push({ nom, fichier: fichierPhoto, raison: error.message });
          } else {
            const {
              data: { publicUrl },
            } = storage.getPublicUrl(chemin);
            await client.query(
              `INSERT INTO "catalogue_produit_photos"
                 ("id", "catalogue_produit_id", "url", "ordre", "date_ajout")
               VALUES (gen_random_uuid(), $1, $2, 0, now())`,
              [ficheId, publicUrl],
            );
            photosOk += 1;
          }
        }

        await client.query("COMMIT");
        crees += 1;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      if (crees % 250 === 0) console.log(`    ... ${crees} fiches creees`);
    }
  } finally {
    await client.end();
  }

  const prefixe = dryRun ? "[dry-run] " : "";
  console.log(`\n${prefixe}Rapport`);
  console.log(`  produits ${dryRun ? "a creer" : "crees"}            ${crees}`);
  console.log(`  ignores (deja existants)     ${ignores}`);
  console.log(`  photos ${dryRun ? "a televerser" : "televersees"}        ${photosOk}`);
  console.log(`  photos manquantes/en echec   ${photosEchouees.length}`);

  if (doublons.length > 0) {
    console.log("\n  Exemples d'ignores (cle nom + sous-categorie deja vue) :");
    for (const d of doublons.slice(0, 10)) {
      console.log(`    - ${d.nom.slice(0, 62)}  [${d.sousCategorie.slice(0, 24)}]`);
    }
  }

  if (photosEchouees.length > 0) {
    console.log("\n  Produits sans photo, a traiter a la main :");
    for (const e of photosEchouees.slice(0, 25)) {
      console.log(`    - ${e.nom.slice(0, 56)} | ${e.fichier} (${e.raison})`);
    }
    if (photosEchouees.length > 25) {
      console.log(`    et ${photosEchouees.length - 25} autre(s).`);
    }
  }

  console.log(dryRun ? "\n[dry-run] Rien n'a ete ecrit.\n" : "\nImport termine.\n");
}

main().catch((error) => {
  console.error("\nImport interrompu :\n", error);
  process.exit(1);
});
