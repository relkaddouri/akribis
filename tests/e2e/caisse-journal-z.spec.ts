/**
 * Caisse et Journal Z, de bout en bout, dans le navigateur.
 *
 * Joue une journée de caisse complète contre l'application lancée en local
 * et la base désignée par `.env` — qui doit être étiquetée `staging` ou
 * `development` (voir docs/deploiement.md §3). Toutes les données sont
 * créées dans une pharmacie dédiée, « E2E Caisse … », et supprimées à la
 * fin ; aucune autre pharmacie n'est lue ni écrite.
 *
 * Seule exception au nettoyage : `event_log`. La base y refuse toute
 * suppression (déclencheur `event_log_ni_update_ni_delete`), c'est voulu.
 * Les entrées restent, rattachées à un `pharmacy_id` qui n'existe plus.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { config as chargerEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { expect, test, type Browser, type Page } from "@playwright/test";

chargerEnv({ quiet: true });

// ── Garde-fou : jamais la production ────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const DB_ENVIRONMENT = process.env.DB_ENVIRONMENT?.trim().toLowerCase();

/**
 * Même règle que prisma/seed-guard.ts : sans étiquette explicite, on
 * refuse. Un test qui crée et supprime des comptes ne doit pas pouvoir
 * viser la production parce qu'un fichier `.env` a été échangé.
 */
function verifierCible(): void {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requises.");
  }
  if (DB_ENVIRONMENT !== "staging" && DB_ENVIRONMENT !== "development") {
    throw new Error(
      `Refus : DB_ENVIRONMENT vaut « ${DB_ENVIRONMENT ?? "(absent)"} » pour ${new URL(SUPABASE_URL).host}. ` +
        "Ce test ne tourne que contre une base étiquetée staging ou development.",
    );
  }
  const prod = process.env.E2E_PROD_SUPABASE_URL?.trim();
  if (prod && new URL(prod).host === new URL(SUPABASE_URL).host) {
    throw new Error(`Refus : ${SUPABASE_URL} est l'URL de production.`);
  }
}

// ── Données de test ─────────────────────────────────────────────────────

const RUN = randomBytes(4).toString("hex");
const MOT_DE_PASSE = `E2e-${randomBytes(12).toString("base64url")}`;
const PIN = "4826";

const PRODUITS = {
  // Prix TTC choisis pour que chaque montant du scénario tombe juste.
  tva0: { nom: `E2E Produit TVA0 ${RUN}`, code: `E2E0${RUN}`, prix: 20, tva: 0, remboursable: false },
  tva7: { nom: `E2E Produit TVA7 ${RUN}`, code: `E2E7${RUN}`, prix: 15, tva: 7, remboursable: false },
  tva20: { nom: `E2E Produit TVA20 ${RUN}`, code: `E2E20${RUN}`, prix: 50, tva: 20, remboursable: true },
} as const;
type CleProduit = keyof typeof PRODUITS;

type Fixture = {
  pharmacyId: string;
  owner: { id: string; email: string };
  assistant: { id: string; email: string };
  clientNom: string;
  organismeNom: string;
};

let admin: SupabaseClient;
let db: Pool;
let fx: Fixture;

function maintenant(): string {
  return new Date().toISOString();
}

/** `?pgbouncer=true` est une option Prisma, inconnue du driver pg. */
function urlBase(): string {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.searchParams.delete("pgbouncer");
  return url.toString();
}

/**
 * Tente une écriture qui doit être refusée, dans une transaction toujours
 * annulée : si le verrou manquait, la vente n'en serait pas abîmée pour
 * autant. Rend le message d'erreur, ou `null` si l'écriture est passée.
 */
async function tenter(texte: string, valeurs: unknown[]): Promise<string | null> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(texte, valeurs);
    return null;
  } catch (e) {
    return (e as Error).message;
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

/**
 * Les tables métier passent par Postgres directement, comme l'application
 * (Prisma sur DATABASE_URL) : l'API REST de Supabase n'a aucun droit sur
 * elles, même avec la clé service_role. Celle-ci ne sert qu'à Supabase Auth.
 */
async function sql<T = Record<string, unknown>>(texte: string, valeurs: unknown[] = []): Promise<T[]> {
  const resultat = await db.query(texte, valeurs);
  return resultat.rows as T[];
}

async function inserer(table: string, ligne: Record<string, unknown>): Promise<void> {
  const colonnes = Object.keys(ligne);
  await sql(
    `INSERT INTO "${table}" (${colonnes.map((c) => `"${c}"`).join(", ")})
     VALUES (${colonnes.map((_, i) => `$${i + 1}`).join(", ")})`,
    Object.values(ligne),
  );
}

async function creerCompte(
  pharmacyId: string,
  role: "owner" | "assistant",
): Promise<{ id: string; email: string }> {
  const email = `e2e-caisse-${role}-${RUN}@akribis.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: MOT_DE_PASSE,
    email_confirm: true,
    app_metadata: { role, pharmacy_id: pharmacyId },
  });
  if (error || !data.user) throw new Error(`createUser ${role} : ${error?.message}`);
  await inserer("users", {
    id: data.user.id,
    pharmacy_id: pharmacyId,
    name: `E2E ${role === "owner" ? "Titulaire" : "Assistant"} ${RUN}`,
    email,
    role,
    updated_at: maintenant(),
  });
  return { id: data.user.id, email };
}

async function preparer(): Promise<Fixture> {
  const pharmacyId = randomUUID();
  await inserer("pharmacies", {
    id: pharmacyId,
    name: `E2E Caisse ${RUN}`,
    updated_at: maintenant(),
  });

  const owner = await creerCompte(pharmacyId, "owner");
  const assistant = await creerCompte(pharmacyId, "assistant");

  for (const p of Object.values(PRODUITS)) {
    await inserer("products", {
      id: randomUUID(),
      pharmacy_id: pharmacyId,
      name: p.nom,
      form: "Comprimé",
      barcode: p.code,
      price: p.prix,
      tva_vente: p.tva,
      quantity_in_stock: 100,
      remboursable: p.remboursable,
      base_remboursement: p.remboursable ? p.prix : null,
      updated_at: maintenant(),
    });
  }

  const organismeNom = `E2E Mutuelle ${RUN}`;
  await inserer("organismes_tiers_payant", {
    id: randomUUID(),
    pharmacy_id: pharmacyId,
    nom: organismeNom,
    code: `E2E${RUN}`,
    taux_couverture: 70,
    actif: true,
    updated_at: maintenant(),
  });

  // Sans organisme : la vente à crédit ne doit pas hériter d'un tiers payant.
  const clientNom = `E2E Client ${RUN}`;
  await inserer("clients", {
    id: randomUUID(),
    pharmacy_id: pharmacyId,
    name: clientNom,
    updated_at: maintenant(),
  });

  return { pharmacyId, owner, assistant, clientNom, organismeNom };
}

/**
 * Tout, sauf event_log. L'ordre compte :
 *
 * - les sessions d'abord : le déclencheur `vente_session_cloturee_figee`
 *   refuse de supprimer une vente d'une session clôturée. Supprimer la
 *   session met `caisse_session_id` à NULL (ON DELETE SET NULL), après
 *   quoi la vente n'est plus rattachée à rien et peut partir ;
 * - `caisse_sessions.ouverte_par` est en RESTRICT vers `users` : la
 *   session doit disparaître avant les comptes ;
 * - `document_counters` n'a pas de clé étrangère vers la pharmacie.
 */
async function nettoyer(f: Fixture | undefined): Promise<void> {
  if (!f) return;
  const erreurs: string[] = [];
  const etape = async (nom: string, action: () => Promise<unknown>) => {
    try {
      const r = (await action()) as { error?: { message?: string } | null } | undefined;
      if (r && typeof r === "object" && "error" in r && r.error) {
        erreurs.push(`${nom} : ${r.error.message ?? r.error}`);
      }
    } catch (e) {
      erreurs.push(`${nom} : ${(e as Error).message}`);
    }
  };

  await etape("caisse_sessions", () =>
    sql(`DELETE FROM caisse_sessions WHERE pharmacy_id = $1`, [f.pharmacyId]),
  );
  await etape("document_counters", () =>
    sql(`DELETE FROM document_counters WHERE pharmacy_id = $1`, [f.pharmacyId]),
  );
  await etape("pharmacies", () => sql(`DELETE FROM pharmacies WHERE id = $1`, [f.pharmacyId]));
  for (const compte of [f.owner, f.assistant]) {
    if (compte) await etape(`auth ${compte.email}`, () => admin.auth.admin.deleteUser(compte.id));
  }

  if (erreurs.length > 0) {
    throw new Error(`Nettoyage incomplet de la pharmacie ${f.pharmacyId} :\n${erreurs.join("\n")}`);
  }
}

// ── Lecture en base (contrôles, jamais d'écriture hors préparation) ─────

type Vente = {
  id: string;
  total_amount: number;
  payment_method: string;
  montant_part_client: number;
  montant_part_assurance: number;
  caisse_session_id: string | null;
};

async function ventes(): Promise<Vente[]> {
  const lignes = await sql<Vente>(
    `SELECT id, total_amount, payment_method::text AS payment_method, montant_part_client,
            montant_part_assurance, caisse_session_id
       FROM sales WHERE pharmacy_id = $1 ORDER BY created_at`,
    [fx.pharmacyId],
  );
  return lignes.map((v) => ({
    ...v,
    total_amount: Number(v.total_amount),
    montant_part_client: Number(v.montant_part_client),
    montant_part_assurance: Number(v.montant_part_assurance),
  }));
}

/** Les ventes partent par la file hors ligne : on attend qu'elles soient en base. */
async function attendreVentes(nombre: number): Promise<Vente[]> {
  await expect
    .poll(async () => (await ventes()).length, {
      message: `${nombre} vente(s) synchronisée(s)`,
      timeout: 30_000,
    })
    .toBe(nombre);
  return ventes();
}

async function derniereSession(): Promise<{
  id: string;
  statut: string;
  especes_theoriques: number | null;
  especes_reelles: number | null;
  ecart_caisse: number | null;
  fermeture_par_pin: boolean;
}> {
  const [data] = await sql<{
    id: string;
    statut: string;
    especes_theoriques: string | null;
    especes_reelles: string | null;
    ecart_caisse: string | null;
    fermeture_par_pin: boolean;
  }>(
    `SELECT id, statut::text AS statut, especes_theoriques, especes_reelles, ecart_caisse,
            fermeture_par_pin
       FROM caisse_sessions WHERE pharmacy_id = $1 ORDER BY date_ouverture DESC LIMIT 1`,
    [fx.pharmacyId],
  );
  if (!data) throw new Error("Aucune session de caisse pour la pharmacie de test.");
  return {
    ...data,
    especes_theoriques: data.especes_theoriques === null ? null : Number(data.especes_theoriques),
    especes_reelles: data.especes_reelles === null ? null : Number(data.especes_reelles),
    ecart_caisse: data.ecart_caisse === null ? null : Number(data.ecart_caisse),
  };
}

// ── PDF ─────────────────────────────────────────────────────────────────

/**
 * Le texte d'un PDF produit par pdf-lib, dans l'ordre d'écriture.
 *
 * Pas de dépendance : pdf-lib écrit chaque `drawText` comme une chaîne
 * hexadécimale WinAnsi suivie de `Tj`, dans des flux Flate. On décompresse
 * chaque flux et on relève ces chaînes. WinAnsi coïncide avec latin-1 pour
 * tous les caractères du Z (é, è, à…).
 */
function textePdf(octets: Buffer): string[] {
  const brut = octets.toString("latin1");
  const morceaux: string[] = [];
  const flux = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = flux.exec(brut))) {
    const debut = m.index + m[0].length;
    const fin = brut.indexOf("endstream", debut);
    if (fin < 0) break;
    const contenu = octets.subarray(debut, fin);
    let texte: string;
    try {
      texte = inflateSync(contenu).toString("latin1");
    } catch {
      texte = contenu.toString("latin1");
    }
    for (const t of texte.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
      morceaux.push(Buffer.from(t[1]!, "hex").toString("latin1"));
    }
    for (const t of texte.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
      morceaux.push(t[1]!.replace(/\\(.)/g, "$1"));
    }
    flux.lastIndex = fin;
  }
  return morceaux.map((s) => s.replace(/[  ]/g, " ").trim()).filter(Boolean);
}

/** La valeur écrite juste après un libellé (libellé à gauche, montant à droite). */
function apres(textes: string[], libelle: string): string | undefined {
  const i = textes.indexOf(libelle);
  return i < 0 ? undefined : textes[i + 1];
}

async function telechargerZ(page: Page): Promise<string[]> {
  const [telechargement] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: /Imprimer le Z/ }).click(),
  ]);
  const chemin = await telechargement.path();
  return textePdf(await readFile(chemin));
}

// ── Navigateur ──────────────────────────────────────────────────────────

async function connecter(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(MOT_DE_PASSE);
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

async function nouvelleSession(browser: Browser, email: string): Promise<Page> {
  const contexte = await browser.newContext();
  const page = await contexte.newPage();
  await connecter(page, email);
  return page;
}

async function ajouterProduit(page: Page, cle: CleProduit, quantite = 1): Promise<void> {
  const { nom, code } = PRODUITS[cle];
  const recherche = page.getByLabel("Rechercher un produit");
  await recherche.fill(code);
  // La liste vient d'IndexedDB, remplie par la synchronisation : on attend
  // le résultat plutôt que de compter sur un scan qui tomberait à vide.
  await page.locator("li button", { hasText: nom }).first().click({ timeout: 20_000 });
  for (let i = 1; i < quantite; i++) {
    await page.getByRole("button", { name: `Ajouter une unité de ${nom}` }).click();
  }
}

async function validerVente(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Valider la vente" }).click();
  const ticket = page.getByRole("dialog", { name: "Vente enregistrée" });
  await expect(ticket).toBeVisible({ timeout: 20_000 });
  await ticket.getByRole("button", { name: "Nouvelle vente" }).click();
  await expect(ticket).toBeHidden();
}

function zoneMonnaie(page: Page) {
  return page.getByText(/Monnaie à rendre|Montant manquant/).locator("..");
}

async function ouvrirDepuisJournalZ(page: Page, fond: number): Promise<void> {
  await page.goto("/caisse");
  await page.locator("#fond").fill(String(fond));
  await page.getByRole("button", { name: "Ouvrir la caisse", exact: true }).click();
  await expect(page.getByText(/Caisse ouverte depuis/)).toBeVisible({ timeout: 15_000 });
}

async function cloturerDepuisJournalZ(
  page: Page,
  especes: number,
  pin?: string,
): Promise<ReturnType<Page["getByRole"]>> {
  await page.goto("/caisse");
  await page.getByRole("button", { name: "Clôturer la caisse" }).click();
  const dialogue = page.getByRole("dialog", { name: "Clôture de caisse" });
  await dialogue.locator("#especes").fill(String(especes));
  if (pin !== undefined) await dialogue.locator("#pin").fill(pin);
  await dialogue.getByRole("button", { name: "Valider le comptage" }).click();
  return dialogue;
}

/** La ligne la plus récente de l'historique des Z (tri par ouverture décroissante). */
function premiereLigneHistorique(page: Page) {
  return page.locator("table tbody tr").first();
}

// ── Scénarios ───────────────────────────────────────────────────────────

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

test.beforeAll(async () => {
  verifierCible();
  admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  db = new Pool({ connectionString: urlBase(), max: 2 });
  fx = await preparer();
});

test.afterAll(async () => {
  try {
    if (admin && db) await nettoyer(fx);
  } finally {
    await db?.end();
  }
});

test("scénario 1 — journée juste et Journal Z", async ({ page }) => {
  await connecter(page, fx.owner.email);

  // 1. Sans caisse ouverte, le comptoir est inerte derrière la fenêtre d'ouverture.
  await page.goto("/dashboard/pos");
  const ouverture = page.getByRole("dialog", { name: "Ouvrir la caisse" });
  await expect(ouverture).toBeVisible();
  await expect(page.locator('[inert] input[aria-label="Rechercher un produit"]')).toHaveCount(1);

  // 2. Fond de caisse 500.
  await ouverture.locator("#fond-caisse").fill("500");
  await ouverture.getByRole("button", { name: "Ouvrir la caisse et commencer" }).click();
  await expect(ouverture).toBeHidden({ timeout: 60_000 });
  await expect(page.locator("[inert]")).toHaveCount(0);

  // 3. Vente A : 120 en espèces, 200 reçus → 80 rendus.
  await ajouterProduit(page, "tva20", 2);
  await ajouterProduit(page, "tva0", 1);
  await page.getByRole("button", { name: "Espèces", exact: true }).click();
  await page.locator("#cash-received").fill("200");
  await expect(zoneMonnaie(page)).toContainText("Monnaie à rendre");
  await expect(zoneMonnaie(page)).toContainText("80,00");
  await validerVente(page);

  // 4. Vente B : 85 par carte.
  await ajouterProduit(page, "tva20", 1);
  await ajouterProduit(page, "tva7", 1);
  await ajouterProduit(page, "tva0", 1);
  await page.getByRole("button", { name: "Carte", exact: true }).click();
  await validerVente(page);

  // 5. Vente C : 300 en espèces, tiers payant 70 % → le client paie 90.
  await ajouterProduit(page, "tva20", 6);
  await page.locator("#organisme-vente").click();
  await page.getByRole("option", { name: `${fx.organismeNom} — 70 %` }).click();
  await page.getByRole("button", { name: "Espèces", exact: true }).click();
  // 100 reçus pour 90 dus : 10 rendus prouve que seule la part client est encaissée.
  await page.locator("#cash-received").fill("100");
  await expect(zoneMonnaie(page)).toContainText("Monnaie à rendre");
  await expect(zoneMonnaie(page)).toContainText("10,00");
  await validerVente(page);

  // 6. Vente D : 50 à crédit pour le client.
  await ajouterProduit(page, "tva0", 1);
  await ajouterProduit(page, "tva7", 2);
  await page.getByLabel("Rechercher un client").fill(fx.clientNom);
  await page.locator("li button", { hasText: fx.clientNom }).first().click();
  await page.getByRole("button", { name: /Crédit client \(à payer plus tard\)/ }).click();
  await validerVente(page);

  const [a, b, c, d] = await attendreVentes(4);
  expect([a, b, c, d].map((v) => [v!.payment_method, v!.total_amount])).toEqual([
    ["cash", 120],
    ["card", 85],
    ["cash", 300],
    ["credit", 50],
  ]);
  expect(c!.montant_part_client).toBe(90);
  expect(c!.montant_part_assurance).toBe(210);

  // 7. Retour de 20 en espèces sur la vente A.
  await page.goto(`/ventes/${a!.id}`);
  await page.getByRole("button", { name: "Effectuer un retour" }).click();
  const retour = page.getByRole("dialog", { name: "Effectuer un retour" });
  await retour.getByLabel(`Quantité à retourner pour ${PRODUITS.tva0.nom}`).fill("1");
  await expect(retour).toContainText("20,00 MAD");
  await retour.getByRole("button", { name: "Confirmer le retour" }).click();
  await expect(retour).toBeHidden({ timeout: 15_000 });

  // 8. Clôture avec 690 comptés → « Juste ».
  const cloture = await cloturerDepuisJournalZ(page, 690);
  await expect(cloture).toBeHidden({ timeout: 15_000 });
  await expect(premiereLigneHistorique(page)).toContainText("Juste");
  const session = await derniereSession();
  expect(session).toMatchObject({
    statut: "cloturee",
    especes_theoriques: 690,
    especes_reelles: 690,
    ecart_caisse: 0,
  });

  // 9. Journal Z en PDF.
  await premiereLigneHistorique(page).click();
  await expect(page).toHaveURL(new RegExp(`/caisse/${session.id}$`));
  await expect(page.getByText("Le compte y est")).toBeVisible();
  const z = await telechargerZ(page);

  expect.soft(apres(z, "Espèces"), "Espèces (part client, nette des retours)").toBe("190,00 MAD");
  expect.soft(apres(z, "Carte")).toBe("85,00 MAD");
  expect.soft(apres(z, "Crédit client")).toBe("50,00 MAD");
  expect.soft(apres(z, "Part organisme (à réclamer)")).toBe("210,00 MAD");
  expect.soft(apres(z, "Retours et annulations")).toBe("- 20,00 MAD");
  for (const taux of ["0 %", "7 %", "20 %"]) {
    expect.soft(z.filter((t) => t === taux), `une ligne de TVA à ${taux}`).toHaveLength(1);
  }
  expect.soft(apres(z, "Espèces théoriques"), "attendu").toBe("690,00 MAD");
  expect.soft(apres(z, "Espèces comptées"), "compté").toBe("690,00 MAD");
  // Écart nul : le Z l'écrit « Le compte y est » plutôt que « 0,00 MAD ».
  expect.soft(z, "écart 0").toContain("Le compte y est");
});

test("scénario 2 — écart de caisse négatif", async ({ page }) => {
  await connecter(page, fx.owner.email);
  const avant = (await ventes()).length;

  await ouvrirDepuisJournalZ(page, 500);

  await page.goto("/dashboard/pos");
  await ajouterProduit(page, "tva20", 2);
  await page.getByRole("button", { name: "Espèces", exact: true }).click();
  await validerVente(page);
  await attendreVentes(avant + 1);

  const cloture = await cloturerDepuisJournalZ(page, 580);
  await expect(cloture).toBeHidden({ timeout: 15_000 });
  // U+2212 à l'écran, comme dans EcartBadge.
  await expect(premiereLigneHistorique(page)).toContainText("−20,00 MAD");
  const session = await derniereSession();
  expect(session).toMatchObject({ especes_theoriques: 600, especes_reelles: 580, ecart_caisse: -20 });

  await premiereLigneHistorique(page).click();
  await expect(page.getByText("−20,00 MAD").first()).toBeVisible();
  const z = await telechargerZ(page);
  expect.soft(z, "écart dans le PDF").toContain("-20,00 MAD");
  expect.soft(apres(z, "Espèces théoriques")).toBe("600,00 MAD");
  expect.soft(apres(z, "Espèces comptées")).toBe("580,00 MAD");
});

test("scénario 3 — une session clôturée est verrouillée, le retour reste possible", async ({
  page,
}) => {
  const session = await derniereSession();
  expect(session.statut).toBe("cloturee");
  const vente = (await ventes()).find((v) => v.caisse_session_id === session.id);
  expect(vente, "la vente du scénario 2").toBeDefined();

  // Modification : refusée par la base.
  expect.soft(
    await tenter(`UPDATE sales SET total_amount = 1 WHERE id = $1`, [vente!.id]),
    "modification du montant",
  ).toMatch(/session de caisse clôturée/);
  expect.soft(
    await tenter(`UPDATE sale_items SET quantity = 99 WHERE sale_id = $1`, [vente!.id]),
    "modification d'une ligne",
  ).toMatch(/session clôturée/);

  // Suppression : refusée par la base.
  expect.soft(
    await tenter(`DELETE FROM sales WHERE id = $1`, [vente!.id]),
    "suppression",
  ).toMatch(/suppression refusée/);

  const relue = (await ventes()).find((v) => v.id === vente!.id);
  expect(relue?.total_amount, "la vente est intacte").toBe(100);

  // L'écran ne propose ni l'un ni l'autre.
  await connecter(page, fx.owner.email);
  await page.goto(`/ventes/${vente!.id}`);
  await expect(page.getByRole("button", { name: "Effectuer un retour" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Modifier|Supprimer|Annuler la vente/ })).toHaveCount(0);

  // Le retour, lui, passe.
  await page.getByRole("button", { name: "Effectuer un retour" }).click();
  const retour = page.getByRole("dialog", { name: "Effectuer un retour" });
  await retour.getByLabel(`Quantité à retourner pour ${PRODUITS.tva20.nom}`).fill("1");
  await retour.getByRole("button", { name: "Confirmer le retour" }).click();
  await expect(retour).toBeHidden({ timeout: 15_000 });

  await expect
    .poll(async () => {
      const lignes = await sql<{ total_refund: string }>(
        `SELECT total_refund FROM sale_returns WHERE sale_id = $1`,
        [vente!.id],
      );
      return lignes.map((r) => Number(r.total_refund));
    })
    .toEqual([50]);
});

test("scénario 4 — PIN de clôture pour l'assistant", async ({ page, browser }) => {
  // Le titulaire active le PIN dans Paramètres → Caisse.
  await connecter(page, fx.owner.email);
  await page.goto("/parametres");
  await page.getByRole("tab", { name: "Caisse" }).click();
  await page.locator("#cloture-assistant").click();
  await page.locator("#cloture-pin").fill(PIN);
  await page.getByRole("button", { name: "Enregistrer le code" }).click();
  await expect(page.getByText("Code PIN enregistré.")).toBeVisible({ timeout: 15_000 });

  // L'assistant ouvre la caisse, puis tente un mauvais PIN.
  const assistant = await nouvelleSession(browser, fx.assistant.email);
  await ouvrirDepuisJournalZ(assistant, 300);

  const refus = await cloturerDepuisJournalZ(assistant, 300, "0000");
  await expect(refus.getByText("Code PIN incorrect.")).toBeVisible({ timeout: 15_000 });
  expect((await derniereSession()).statut).toBe("ouverte");

  // Le refus figure au journal d'audit du titulaire.
  await page.goto("/parametres");
  await page.getByRole("tab", { name: "Journal d'audit" }).click();
  await expect(page.getByText("Code PIN de clôture refusé").first()).toBeVisible();

  // Le bon PIN clôture, et la session le dit.
  const ok = await cloturerDepuisJournalZ(assistant, 300, PIN);
  await expect(ok).toBeHidden({ timeout: 15_000 });
  await expect(premiereLigneHistorique(assistant)).toContainText("par code PIN");
  await expect(premiereLigneHistorique(assistant)).toContainText("Juste");
  expect(await derniereSession()).toMatchObject({ statut: "cloturee", fermeture_par_pin: true });

  await assistant.context().close();
});
