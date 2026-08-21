"use server";

/**
 * Les organismes de tiers payant d'une officine.
 *
 * Réservé au titulaire. `/parametres` figure déjà dans OWNER_ONLY_PREFIXES
 * — middleware — et la page appelle `requireOwner()`. Chaque action le
 * revérifie néanmoins pour son compte : une action serveur est joignable
 * en POST sans traverser ni le middleware ni le layout, et c'est la seule
 * des trois couches que le client ne peut pas contourner.
 *
 * Toutes les requêtes sont bornées à `owner.pharmacyId`. Aucun identifiant
 * venu du formulaire n'est utilisé seul dans un `where` : il désignerait
 * l'organisme d'une autre pharmacie aussi bien que le sien.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { requireOwner } from "@/lib/auth/session";
import { organismeSchema, type OrganismeInput } from "@/lib/validations/pharmacy";

const SETTINGS_PATH = "/parametres";

export type OrganismeRecord = {
  id: string;
  nom: string;
  code: string;
  /** Aplati depuis un `Decimal`, qui n'est pas sérialisable vers le client. */
  tauxCouverture: number;
  formatBordereau: string | null;
  actif: boolean;
};

export type OrganismeResult = { ok: true; id: string } | { ok: false; error: string };

export async function listOrganismes(): Promise<OrganismeRecord[]> {
  const owner = await requireOwner();

  const organismes = await prisma.organismeTiersPayant.findMany({
    where: { pharmacyId: owner.pharmacyId },
    // Les actifs d'abord : ce sont ceux qu'on vient consulter. Les
    // désactivés restent visibles, sans quoi on ne pourrait pas les
    // remettre en service.
    orderBy: [{ actif: "desc" }, { nom: "asc" }],
  });

  return organismes.map((organisme) => ({
    id: organisme.id,
    nom: organisme.nom,
    code: organisme.code,
    tauxCouverture: Number(organisme.tauxCouverture),
    formatBordereau: organisme.formatBordereau,
    actif: organisme.actif,
  }));
}

/** Le code est unique par officine — voir l'index de la migration. */
function messageDeDoublon(error: unknown, code: string): string | null {
  const known = error as { code?: string } | null;
  if (known?.code !== "P2002") return null;
  return `Un organisme portant le code « ${code} » existe déjà. Ouvrez-le plutôt que d'en créer un second.`;
}

export async function createOrganisme(input: OrganismeInput): Promise<OrganismeResult> {
  const owner = await requireOwner();

  const parsed = organismeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide" };
  }

  try {
    const organisme = await prisma.organismeTiersPayant.create({
      data: { pharmacyId: owner.pharmacyId, ...parsed.data },
    });
    revalidatePath(SETTINGS_PATH);
    return { ok: true, id: organisme.id };
  } catch (error) {
    const message = messageDeDoublon(error, parsed.data.code);
    if (message) return { ok: false, error: message };
    throw error;
  }
}

export async function updateOrganisme(
  id: string,
  input: OrganismeInput,
): Promise<OrganismeResult> {
  const owner = await requireOwner();

  const parsed = organismeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide" };
  }

  // `update` ne sait pas combiner id et pharmacyId — il n'existe pas de clé
  // composée pour ça — donc l'appartenance est vérifiée avant.
  const existant = await prisma.organismeTiersPayant.findFirst({
    where: { id, pharmacyId: owner.pharmacyId },
    select: { id: true },
  });
  if (!existant) return { ok: false, error: "Organisme introuvable." };

  try {
    await prisma.organismeTiersPayant.update({ where: { id }, data: parsed.data });
    revalidatePath(SETTINGS_PATH);
    return { ok: true, id };
  } catch (error) {
    const message = messageDeDoublon(error, parsed.data.code);
    if (message) return { ok: false, error: message };
    throw error;
  }
}

/**
 * Désactive un organisme, ou le remet en service. Jamais de suppression :
 * des ventes passées le référencent, et les faire disparaître fausserait
 * la traçabilité même à laquelle elles servent.
 */
export async function setOrganismeActif(id: string, actif: boolean): Promise<OrganismeResult> {
  const owner = await requireOwner();

  const existant = await prisma.organismeTiersPayant.findFirst({
    where: { id, pharmacyId: owner.pharmacyId },
    select: { id: true },
  });
  if (!existant) return { ok: false, error: "Organisme introuvable." };

  await prisma.organismeTiersPayant.update({ where: { id }, data: { actif } });
  revalidatePath(SETTINGS_PATH);
  return { ok: true, id };
}
