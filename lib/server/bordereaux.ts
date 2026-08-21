"use server";

/**
 * Les bordereaux de tiers payant : ce que l'officine réclame à un
 * organisme, et le suivi de ce qu'il en fait.
 *
 * Deux règles gouvernent tout le module.
 *
 * **Une vente n'appartient qu'à un bordereau actif.** Le statut de créance
 * filtre les candidates, mais c'est un index unique partiel sur
 * `bordereau_ventes` qui le garantit — voir la migration. Deux créations
 * concurrentes liraient le même statut au même instant ; seule la base
 * peut les départager.
 *
 * **Un rejet remet la vente en circulation.** L'organisme refuse, la
 * ligne passe en rejeté et la vente redevient réclamable dans un
 * bordereau suivant, une fois corrigée. C'est pour cela que l'index ne
 * porte que sur les lignes non rejetées.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import {
  formatNumeroBordereau,
  montantAttendu,
  rapprocher,
  scopeCompteur,
  type Rapprochement,
} from "@/lib/bordereaux/rapprochement";
import { formatSaleReference } from "@/lib/sales/returns";

const BORDEREAUX_PATH = "/bordereaux";

export type StatutBordereauValue = "BROUILLON" | "ENVOYE" | "EN_TRAITEMENT" | "CLOTURE";
export type StatutLigneValue = "EN_ATTENTE" | "ACCEPTEE" | "REJETEE";

export type BordereauListItem = {
  id: string;
  numero: string;
  insurerNom: string;
  insurerId: string;
  periodeDebut: Date;
  periodeFin: Date;
  nombreVentes: number;
  montantReclame: number;
  statut: StatutBordereauValue;
};

export type VenteEligible = {
  saleId: string;
  reference: string;
  createdAt: Date;
  clientName: string | null;
  totalAmount: number;
  montantPartAssurance: number;
};

export type BordereauDetail = Omit<BordereauListItem, "nombreVentes" | "montantReclame"> & {
  montantAttendu: number;
  montantRecu: number | null;
  dateRapprochement: Date | null;
  lignes: Array<{
    id: string;
    saleId: string;
    reference: string;
    createdAt: Date;
    clientName: string | null;
    montantReclame: number;
    statut: StatutLigneValue;
    motifRejet: string | null;
  }>;
};

export type BordereauResult = { ok: true; id: string } | { ok: false; error: string };

export async function listBordereaux(): Promise<BordereauListItem[]> {
  const user = await requireUser();

  const bordereaux = await prisma.bordereau.findMany({
    where: { pharmacyId: user.pharmacyId },
    orderBy: { createdAt: "desc" },
    include: { insurer: { select: { id: true, nom: true } }, lignes: true },
  });

  return bordereaux.map((bordereau) => ({
    id: bordereau.id,
    numero: bordereau.numero,
    insurerId: bordereau.insurer.id,
    insurerNom: bordereau.insurer.nom,
    periodeDebut: bordereau.periodeDebut,
    periodeFin: bordereau.periodeFin,
    nombreVentes: bordereau.lignes.length,
    // Ce qui reste réclamé : les rejets ne comptent plus.
    montantReclame: montantAttendu(
      bordereau.lignes.map((ligne) => ({
        montantReclame: Number(ligne.montantReclame),
        statut: ligne.statut,
      })),
    ),
    statut: bordereau.statut as StatutBordereauValue,
  }));
}

/** Bornes d'une période saisie en jours, la fin incluse. */
function bornes(debut: string, fin: string): { gte: Date; lte: Date } {
  return { gte: new Date(`${debut}T00:00:00.000`), lte: new Date(`${fin}T23:59:59.999`) };
}

/**
 * Les ventes qu'un bordereau peut encore réclamer.
 *
 * Le statut `EN_ATTENTE_BORDEREAU` suffit : une vente déjà incluse est
 * passée à `DANS_BORDEREAU`, et une vente rejetée y est revenue.
 */
export async function listVentesEligibles(
  insurerId: string,
  debut: string,
  fin: string,
): Promise<VenteEligible[]> {
  const user = await requireUser();

  const ventes = await prisma.sale.findMany({
    where: {
      pharmacyId: user.pharmacyId,
      insurerId,
      statutCreance: "EN_ATTENTE_BORDEREAU",
      createdAt: bornes(debut, fin),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      createdAt: true,
      totalAmount: true,
      montantPartAssurance: true,
      client: { select: { name: true } },
    },
  });

  return ventes.map((vente) => ({
    saleId: vente.id,
    reference: formatSaleReference(vente.id),
    createdAt: vente.createdAt,
    clientName: vente.client?.name ?? null,
    totalAmount: Number(vente.totalAmount),
    montantPartAssurance: Number(vente.montantPartAssurance),
  }));
}

export async function createBordereau(input: {
  insurerId: string;
  debut: string;
  fin: string;
}): Promise<BordereauResult> {
  const user = await requireUser();

  if (!input.insurerId || !input.debut || !input.fin) {
    return { ok: false, error: "Organisme et période sont requis." };
  }
  if (input.fin < input.debut) {
    return { ok: false, error: "La fin de période précède son début." };
  }

  try {
    const bordereau = await prisma.$transaction(async (tx) => {
      const organisme = await tx.organismeTiersPayant.findFirst({
        where: { id: input.insurerId, pharmacyId: user.pharmacyId },
        select: { id: true },
      });
      if (!organisme) throw new Error("Organisme introuvable.");

      // Relues DANS la transaction : la liste affichée à l'écran date de
      // quelques secondes, et une vente a pu entrer dans un autre
      // bordereau entre-temps.
      const ventes = await tx.sale.findMany({
        where: {
          pharmacyId: user.pharmacyId,
          insurerId: input.insurerId,
          statutCreance: "EN_ATTENTE_BORDEREAU",
          createdAt: bornes(input.debut, input.fin),
        },
        select: { id: true, montantPartAssurance: true },
      });
      if (ventes.length === 0) {
        throw new Error("Aucune vente à réclamer sur cette période.");
      }

      const annee = new Date(input.fin).getUTCFullYear();
      const compteur = await tx.documentCounter.upsert({
        where: { pharmacyId_scope: { pharmacyId: user.pharmacyId, scope: scopeCompteur(annee) } },
        create: { pharmacyId: user.pharmacyId, scope: scopeCompteur(annee), lastSequence: 1 },
        update: { lastSequence: { increment: 1 } },
      });

      const cree = await tx.bordereau.create({
        data: {
          pharmacyId: user.pharmacyId,
          insurerId: input.insurerId,
          numero: formatNumeroBordereau(annee, compteur.lastSequence),
          periodeDebut: new Date(`${input.debut}T00:00:00.000Z`),
          periodeFin: new Date(`${input.fin}T00:00:00.000Z`),
          lignes: {
            create: ventes.map((vente) => ({
              saleId: vente.id,
              montantReclame: vente.montantPartAssurance,
            })),
          },
        },
      });

      await tx.sale.updateMany({
        where: { id: { in: ventes.map((vente) => vente.id) } },
        data: { statutCreance: "DANS_BORDEREAU" },
      });

      return cree;
    });

    revalidatePath(BORDEREAUX_PATH);
    return { ok: true, id: bordereau.id };
  } catch (error) {
    // L'index unique partiel a parlé : une des ventes est déjà réclamée
    // ailleurs, malgré son statut. C'est la course entre deux créations
    // simultanées, et c'est exactement ce qu'il est là pour arrêter.
    if ((error as { code?: string } | null)?.code === "P2002") {
      return {
        ok: false,
        error:
          "Une de ces ventes vient d'être incluse dans un autre bordereau. " +
          "Rechargez la liste avant de recommencer.",
      };
    }
    return { ok: false, error: (error as Error).message };
  }
}

export async function getBordereau(id: string): Promise<BordereauDetail | null> {
  const user = await requireUser();

  const bordereau = await prisma.bordereau.findFirst({
    where: { id, pharmacyId: user.pharmacyId },
    include: {
      insurer: { select: { id: true, nom: true } },
      lignes: {
        orderBy: { createdAt: "asc" },
        include: { sale: { select: { createdAt: true, client: { select: { name: true } } } } },
      },
    },
  });
  if (!bordereau) return null;

  const lignes = bordereau.lignes.map((ligne) => ({
    id: ligne.id,
    saleId: ligne.saleId,
    reference: formatSaleReference(ligne.saleId),
    createdAt: ligne.sale.createdAt,
    clientName: ligne.sale.client?.name ?? null,
    montantReclame: Number(ligne.montantReclame),
    statut: ligne.statut as StatutLigneValue,
    motifRejet: ligne.motifRejet,
  }));

  return {
    id: bordereau.id,
    numero: bordereau.numero,
    insurerId: bordereau.insurer.id,
    insurerNom: bordereau.insurer.nom,
    periodeDebut: bordereau.periodeDebut,
    periodeFin: bordereau.periodeFin,
    statut: bordereau.statut as StatutBordereauValue,
    montantAttendu: montantAttendu(lignes),
    montantRecu: bordereau.montantRecu === null ? null : Number(bordereau.montantRecu),
    dateRapprochement: bordereau.dateRapprochement,
    lignes,
  };
}

/**
 * L'organisme a refusé une ligne.
 *
 * La vente repasse en attente : elle redevient réclamable dans un
 * bordereau suivant, une fois la cause du rejet corrigée. C'est la seule
 * façon de récupérer l'argent, et c'est pour cela que l'index unique ne
 * couvre pas les lignes rejetées.
 */
export async function rejeterLigne(ligneId: string, motif: string): Promise<BordereauResult> {
  const user = await requireUser();

  const motifPropre = motif.trim();
  if (motifPropre === "") {
    return { ok: false, error: "Le motif du rejet est requis." };
  }

  const ligne = await prisma.bordereauVente.findFirst({
    where: { id: ligneId, bordereau: { pharmacyId: user.pharmacyId } },
    select: { id: true, bordereauId: true, saleId: true, statut: true },
  });
  if (!ligne) return { ok: false, error: "Ligne introuvable." };
  if (ligne.statut === "REJETEE") {
    return { ok: false, error: "Cette ligne est déjà rejetée." };
  }

  await prisma.$transaction([
    prisma.bordereauVente.update({
      where: { id: ligne.id },
      data: { statut: "REJETEE", motifRejet: motifPropre },
    }),
    prisma.sale.update({
      where: { id: ligne.saleId },
      data: { statutCreance: "EN_ATTENTE_BORDEREAU" },
    }),
    /**
     * Rejeter après clôture rouvre le bordereau.
     *
     * Le montant attendu baisse, le montant reçu ne bouge pas : le
     * bordereau n'est plus concordant, et le laisser « clôturé »
     * masquerait un écart que l'officine doit précisément réclamer. Le
     * rapprochement est donc à refaire.
     */
    prisma.bordereau.updateMany({
      where: { id: ligne.bordereauId, statut: "CLOTURE" },
      data: { statut: "EN_TRAITEMENT" },
    }),
  ]);

  revalidatePath(`${BORDEREAUX_PATH}/${ligne.bordereauId}`);
  revalidatePath(BORDEREAUX_PATH);
  return { ok: true, id: ligne.bordereauId };
}

/**
 * Annule un rejet saisi par erreur.
 *
 * La vente revient dans ce bordereau — sauf si elle est entre-temps
 * entrée dans un autre. C'est le cas qui donne son sens à l'index unique
 * partiel : rejeter a rendu la vente réclamable ailleurs, et si quelqu'un
 * l'a fait, revenir en arrière ici la réclamerait deux fois. La base
 * refuse, et l'officine doit alors retirer la vente de l'autre bordereau
 * plutôt que de la dupliquer.
 *
 * Le bordereau n'est pas re-clôturé automatiquement : le montant attendu
 * remonte, et c'est un nouveau rapprochement, pas une restauration.
 */
export async function annulerRejet(ligneId: string): Promise<BordereauResult> {
  const user = await requireUser();

  const ligne = await prisma.bordereauVente.findFirst({
    where: { id: ligneId, bordereau: { pharmacyId: user.pharmacyId } },
    select: { id: true, bordereauId: true, saleId: true, statut: true },
  });
  if (!ligne) return { ok: false, error: "Ligne introuvable." };
  if (ligne.statut !== "REJETEE") {
    return { ok: false, error: "Cette ligne n'est pas rejetée." };
  }

  try {
    await prisma.$transaction([
      prisma.bordereauVente.update({
        where: { id: ligne.id },
        // De retour en attente, jamais en accepté : l'organisme ne s'est
        // pas prononcé, c'est l'officine qui s'était trompée.
        data: { statut: "EN_ATTENTE", motifRejet: null },
      }),
      prisma.sale.update({
        where: { id: ligne.saleId },
        data: { statutCreance: "DANS_BORDEREAU" },
      }),
      /**
       * Annuler un rejet rouvre le bordereau, exactement comme rejeter.
       *
       * Le montant attendu **remonte** alors que le versement reçu ne
       * bouge pas : le bordereau n'est plus concordant. Ne rouvrir que
       * dans un sens laissait un bordereau « clôturé » annoncer « réglé »
       * en vert avec 7,14 DH d'écart sous les yeux.
       */
      prisma.bordereau.updateMany({
        where: { id: ligne.bordereauId, statut: "CLOTURE" },
        data: { statut: "EN_TRAITEMENT" },
      }),
    ]);
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "P2002") {
      return {
        ok: false,
        error:
          "Cette vente a depuis été incluse dans un autre bordereau. " +
          "Retirez-la de celui-ci avant d'annuler le rejet.",
      };
    }
    throw error;
  }

  revalidatePath(`${BORDEREAUX_PATH}/${ligne.bordereauId}`);
  revalidatePath(BORDEREAUX_PATH);
  return { ok: true, id: ligne.bordereauId };
}

export type PaiementResult =
  | { ok: true; rapprochement: Rapprochement; cloture: boolean }
  | { ok: false; error: string };

/**
 * Le paiement reçu de l'organisme.
 *
 * Le montant est toujours enregistré, même en cas d'écart : c'est un fait
 * comptable, et le masquer parce qu'il ne tombe pas juste priverait
 * l'officine de la trace dont elle a besoin pour réclamer la différence.
 * Seule la clôture est conditionnée à la concordance.
 */
export async function enregistrerPaiement(
  bordereauId: string,
  montantRecu: number,
): Promise<PaiementResult> {
  const user = await requireUser();

  if (!Number.isFinite(montantRecu) || montantRecu < 0) {
    return { ok: false, error: "Montant reçu invalide." };
  }

  const bordereau = await prisma.bordereau.findFirst({
    where: { id: bordereauId, pharmacyId: user.pharmacyId },
    include: { lignes: { select: { montantReclame: true, statut: true, saleId: true } } },
  });
  if (!bordereau) return { ok: false, error: "Bordereau introuvable." };

  const rapprochement = rapprocher(
    bordereau.lignes.map((ligne) => ({
      montantReclame: Number(ligne.montantReclame),
      statut: ligne.statut,
    })),
    montantRecu,
  );

  const nonRejetees = bordereau.lignes
    .filter((ligne) => ligne.statut !== "REJETEE")
    .map((ligne) => ligne.saleId);

  await prisma.$transaction(async (tx) => {
    await tx.bordereau.update({
      where: { id: bordereau.id },
      data: {
        montantRecu,
        dateRapprochement: new Date(),
        // Un écart laisse le bordereau ouvert : il reste quelque chose à
        // réclamer, ou une ligne à rejeter.
        ...(rapprochement.concordant ? { statut: "CLOTURE" as const } : {}),
      },
    });

    if (rapprochement.concordant && nonRejetees.length > 0) {
      await tx.sale.updateMany({
        where: { id: { in: nonRejetees } },
        data: { statutCreance: "PAYEE" },
      });

      // L'organisme a versé exactement ce qu'on réclamait : il a donc
      // accepté chaque ligne non rejetée. Les laisser « en attente »
      // faisait un écran qui se contredisait — clôturé en haut, en
      // attente partout en dessous.
      await tx.bordereauVente.updateMany({
        where: { bordereauId: bordereau.id, statut: { not: "REJETEE" } },
        data: { statut: "ACCEPTEE" },
      });
    }
  });

  revalidatePath(`${BORDEREAUX_PATH}/${bordereau.id}`);
  revalidatePath(BORDEREAUX_PATH);
  return { ok: true, rapprochement, cloture: rapprochement.concordant };
}
