"use server";

/**
 * Le cycle de caisse : ouverture, clôture, historique.
 *
 * Toutes les lectures sont cantonnées à l'officine de l'appelant, comme
 * les autres façades. Deux règles d'accès s'y ajoutent, et elles ne sont
 * pas symétriques : **ouvrir** est permis à tous — l'assistant qui lève le
 * rideau le matin doit pouvoir démarrer la caisse — tandis que **clôturer**
 * arrête la journée comptable et reste au titulaire, sauf PIN.
 */

import { revalidatePath } from "next/cache";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { requireOwner, requireUser } from "@/lib/auth/session";
import { allocateDocumentNumber } from "@/lib/server/sequences";
import { ENTITES, journaliser, TYPES_ACTION } from "@/lib/audit/event-log";
import { hacherPin, pinValide, verifierPin } from "@/lib/caisse/pin";
import {
  ecartCaisse,
  especesTheoriques,
  formatNumeroZ,
  scopeCompteurZ,
  sessionEnRetard,
  totauxZ,
  ventilationParPaiement,
  ventilationTva,
  type LigneTva,
  type VenteDuZ,
  type VentilationPaiement,
} from "@/lib/caisse/journal-z";

const CAISSE_PATH = "/caisse";

export type SessionCaisse = {
  id: string;
  statut: "ouverte" | "cloturee";
  fondCaisseInitial: number;
  dateOuverture: Date;
  ouvertePar: string;
  ouvreurNom: string;
  fermeePar: string | null;
  fermeurNom: string | null;
  dateFermeture: Date | null;
  especesTheoriques: number | null;
  especesReelles: number | null;
  ecartCaisse: number | null;
  numeroZ: string | null;
  fermetureParPin: boolean;
  nombreVentes: number;
};

/** Prisma `Decimal` aplati en nombre, comme dans les autres façades. */
function nombre(valeur: Prisma.Decimal | null): number | null {
  return valeur === null ? null : Number(valeur);
}

type LigneSession = Prisma.CaisseSessionGetPayload<{
  include: {
    ouvreur: { select: { name: true } };
    fermeur: { select: { name: true } };
    _count: { select: { ventes: true } };
  };
}>;

function toSession(ligne: LigneSession): SessionCaisse {
  return {
    id: ligne.id,
    statut: ligne.statut === "CLOTUREE" ? "cloturee" : "ouverte",
    fondCaisseInitial: Number(ligne.fondCaisseInitial),
    dateOuverture: ligne.dateOuverture,
    ouvertePar: ligne.ouvertePar,
    ouvreurNom: ligne.ouvreur.name,
    fermeePar: ligne.fermeePar,
    fermeurNom: ligne.fermeur?.name ?? null,
    dateFermeture: ligne.dateFermeture,
    especesTheoriques: nombre(ligne.especesTheoriques),
    especesReelles: nombre(ligne.especesReelles),
    ecartCaisse: nombre(ligne.ecartCaisse),
    numeroZ: ligne.numeroZ,
    fermetureParPin: ligne.fermetureParPin,
    nombreVentes: ligne._count.ventes,
  };
}

const INCLUDE_SESSION = {
  ouvreur: { select: { name: true } },
  fermeur: { select: { name: true } },
  _count: { select: { ventes: true } },
} as const;

// ── Lecture ─────────────────────────────────────────────────────────────

export async function getSessionOuverte(): Promise<SessionCaisse | null> {
  const user = await requireUser();
  const ligne = await prisma.caisseSession.findFirst({
    where: { pharmacyId: user.pharmacyId, statut: "OUVERTE" },
    include: INCLUDE_SESSION,
  });
  return ligne ? toSession(ligne) : null;
}

export type EtatCaisse =
  | { etat: "aucune" }
  | { etat: "ouverte"; session: SessionCaisse }
  /** Ouverte un autre jour : plus aucune vente tant qu'elle n'est pas close. */
  | { etat: "en_retard"; session: SessionCaisse };

/**
 * Ce que le point de vente doit savoir avant d'accepter quoi que ce soit.
 *
 * Un seul appel rend les trois cas, plutôt que de laisser l'écran
 * recomposer la règle : « pas de session », « session du jour », « session
 * d'hier oubliée » appellent trois messages différents et une seule
 * décision — vendre ou non.
 */
export async function getEtatCaisse(): Promise<EtatCaisse> {
  const session = await getSessionOuverte();
  if (!session) return { etat: "aucune" };
  return sessionEnRetard(session.dateOuverture, new Date())
    ? { etat: "en_retard", session }
    : { etat: "ouverte", session };
}

export async function listSessionsCaisse(): Promise<SessionCaisse[]> {
  const user = await requireUser();
  const lignes = await prisma.caisseSession.findMany({
    where: { pharmacyId: user.pharmacyId },
    orderBy: { dateOuverture: "desc" },
    take: 200,
    include: INCLUDE_SESSION,
  });
  return lignes.map(toSession);
}

// ── Ouverture ───────────────────────────────────────────────────────────

export type ResultatCaisse = { ok: true; id: string } | { ok: false; error: string };

/**
 * Ouvre la caisse de la journée.
 *
 * Permis à tout rôle : c'est le premier geste du matin, souvent fait par
 * l'assistant qui ouvre l'officine.
 *
 * L'unicité de la session ouverte est garantie par un index partiel en
 * base, pas par la lecture ci-dessous : deux onglets ouverts en même temps
 * passeraient tous deux le contrôle applicatif. La violation P2002 est
 * traduite plutôt que remontée en trace Prisma.
 */
export async function ouvrirCaisse(
  fondCaisseInitial: number,
  options?: {
    /** Identifiant fabriqué par l'appareil, pour une ouverture hors ligne. */
    id?: string;
    /** L'heure du rideau levé, et non celle de la synchronisation. */
    dateOuverture?: Date;
  },
): Promise<ResultatCaisse> {
  const user = await requireUser();

  if (!Number.isFinite(fondCaisseInitial) || fondCaisseInitial < 0) {
    return { ok: false, error: "Le fond de caisse doit être un montant positif." };
  }

  // Rejeu d'une ouverture déjà passée : la retrouver et ne rien faire est
  // tout l'intérêt de l'identifiant fabriqué côté appareil. En créer une
  // seconde couperait la journée en deux Z.
  if (options?.id) {
    const deja = await prisma.caisseSession.findFirst({
      where: { id: options.id, pharmacyId: user.pharmacyId },
      select: { id: true },
    });
    if (deja) return { ok: true, id: deja.id };
  }

  try {
    const session = await prisma.$transaction(async (tx) => {
      const creee = await tx.caisseSession.create({
        data: {
          ...(options?.id ? { id: options.id } : {}),
          ...(options?.dateOuverture ? { dateOuverture: options.dateOuverture } : {}),
          pharmacyId: user.pharmacyId,
          ouvertePar: user.id,
          fondCaisseInitial: new Prisma.Decimal(fondCaisseInitial),
        },
      });

      await journaliser(tx, {
        acteur: { id: user.id, email: user.email, role: user.role },
        typeAction: TYPES_ACTION.caisseOuverte,
        entite: ENTITES.caisseSession,
        entiteId: creee.id,
        pharmacyId: user.pharmacyId,
        apres: { fondCaisseInitial, horsLigne: options?.id !== undefined },
      });

      return creee;
    });

    revalidatePath(CAISSE_PATH);
    revalidatePath("/dashboard");
    return { ok: true, id: session.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "Une session de caisse est déjà ouverte." };
    }
    throw error;
  }
}

// ── Clôture ─────────────────────────────────────────────────────────────

/** Les ventes de la session, aplaties pour le calcul du Z. */
async function ventesDeLaSession(
  db: Prisma.TransactionClient | typeof prisma,
  sessionId: string,
): Promise<VenteDuZ[]> {
  const ventes = await db.sale.findMany({
    where: { caisseSessionId: sessionId },
    select: {
      paymentMethod: true,
      totalAmount: true,
      montantPartClient: true,
      montantPartAssurance: true,
      items: {
        select: {
          quantity: true,
          unitPrice: true,
          product: { select: { tvaVente: true } },
        },
      },
      returns: { select: { totalRefund: true } },
    },
  });

  return ventes.map((vente) => ({
    paymentMethod: vente.paymentMethod,
    totalAmount: Number(vente.totalAmount),
    montantPartClient: Number(vente.montantPartClient),
    montantPartAssurance: Number(vente.montantPartAssurance),
    montantRetourne: vente.returns.reduce((somme, r) => somme + Number(r.totalRefund), 0),
    lignes: vente.items.map((item) => {
      const ttc = Number(item.unitPrice) * item.quantity;
      const taux = Number(item.product.tvaVente ?? 0);
      // Le prix de vente est TTC dans cette application : la base HT s'en
      // déduit, elle ne s'additionne pas par-dessus.
      const ht = taux > 0 ? ttc / (1 + taux / 100) : ttc;
      return {
        totalHt: Math.round(ht * 100) / 100,
        totalTva: Math.round((ttc - ht) * 100) / 100,
        tauxTva: taux,
      };
    }),
  }));
}

/**
 * Le montant théorique, sans le révéler.
 *
 * Appelé pour préparer l'écran de comptage : il ne renvoie **rien** du
 * théorique, seulement de quoi savoir qu'une clôture est possible. Le
 * comptage se fait à l'aveugle, et une valeur envoyée au navigateur y
 * serait lisible dans les outils de développement — ce qui viderait la
 * règle de son sens.
 */
export async function peutCloturer(): Promise<{
  possible: boolean;
  raison?: string;
  pinRequis: boolean;
}> {
  const user = await requireUser();

  const session = await prisma.caisseSession.findFirst({
    where: { pharmacyId: user.pharmacyId, statut: "OUVERTE" },
    select: { id: true },
  });
  if (!session) return { possible: false, raison: "Aucune session ouverte.", pinRequis: false };

  if (user.role === "owner") return { possible: true, pinRequis: false };

  const pharmacy = await prisma.pharmacy.findUniqueOrThrow({
    where: { id: user.pharmacyId },
    select: { clotureAssistantAutorisee: true, cloturePinHash: true },
  });

  if (!pharmacy.clotureAssistantAutorisee || !pharmacy.cloturePinHash) {
    return {
      possible: false,
      raison: "La clôture de caisse est réservée au titulaire.",
      pinRequis: false,
    };
  }
  return { possible: true, pinRequis: true };
}

export type ClotureInput = {
  /** Espèces comptées dans le tiroir, saisies à l'aveugle. */
  especesReelles: number;
  /** Requis pour un assistant lorsque le titulaire l'a autorisé. */
  pin?: string;
};

/**
 * Clôture la caisse et attribue le numéro de Z.
 *
 * Tout se joue dans une transaction : le théorique, l'écart, le numéro et
 * le passage en `cloturee`. Une clôture à moitié écrite laisserait une
 * session sans Z ou un numéro consommé sans session close.
 */
export async function cloturerCaisse(input: ClotureInput): Promise<ResultatCaisse> {
  const user = await requireUser();

  if (!Number.isFinite(input.especesReelles) || input.especesReelles < 0) {
    return { ok: false, error: "Le montant compté doit être un montant positif." };
  }

  const pharmacy = await prisma.pharmacy.findUniqueOrThrow({
    where: { id: user.pharmacyId },
    select: { clotureAssistantAutorisee: true, cloturePinHash: true },
  });

  let parPin = false;
  if (user.role !== "owner") {
    if (!pharmacy.clotureAssistantAutorisee || !pharmacy.cloturePinHash) {
      return { ok: false, error: "La clôture de caisse est réservée au titulaire." };
    }
    if (!input.pin || !verifierPin(input.pin, pharmacy.cloturePinHash)) {
      // Chaque échec laisse une trace : c'est la seule contrepartie à
      // l'absence de blocage après N tentatives, et elle permet au
      // titulaire de voir qu'on a essayé.
      await journaliser(prisma, {
        acteur: { id: user.id, email: user.email, role: user.role },
        typeAction: TYPES_ACTION.caissePinRefuse,
        entite: ENTITES.caisseSession,
        entiteId: user.pharmacyId,
        pharmacyId: user.pharmacyId,
        apres: { motif: input.pin ? "code incorrect" : "code absent" },
      });
      return { ok: false, error: "Code PIN incorrect." };
    }
    parPin = true;
  }

  try {
    const session = await prisma.$transaction(async (tx) => {
      const ouverte = await tx.caisseSession.findFirst({
        where: { pharmacyId: user.pharmacyId, statut: "OUVERTE" },
      });
      if (!ouverte) throw new Error("Aucune session de caisse n'est ouverte.");

      const ventes = await ventesDeLaSession(tx, ouverte.id);
      const fond = Number(ouverte.fondCaisseInitial);
      const theoriques = especesTheoriques(fond, ventes);
      const ecart = ecartCaisse(input.especesReelles, theoriques);

      const fermeture = new Date();
      const sequence = await allocateDocumentNumber(
        tx,
        user.pharmacyId,
        scopeCompteurZ(fermeture) as `caisse_z:${string}`,
      );

      const close = await tx.caisseSession.update({
        where: { id: ouverte.id },
        data: {
          statut: "CLOTUREE",
          fermeePar: user.id,
          dateFermeture: fermeture,
          fermetureParPin: parPin,
          especesTheoriques: new Prisma.Decimal(theoriques),
          especesReelles: new Prisma.Decimal(input.especesReelles),
          ecartCaisse: new Prisma.Decimal(ecart),
          numeroZ: formatNumeroZ(fermeture, sequence),
        },
      });

      await journaliser(tx, {
        acteur: { id: user.id, email: user.email, role: user.role },
        typeAction: TYPES_ACTION.caisseCloturee,
        entite: ENTITES.caisseSession,
        entiteId: close.id,
        pharmacyId: user.pharmacyId,
        avant: { statut: "OUVERTE" },
        apres: {
          nom: close.numeroZ,
          statut: "CLOTUREE",
          especesTheoriques: theoriques,
          especesReelles: input.especesReelles,
          ecartCaisse: ecart,
          fermetureParPin: parPin,
        },
      });

      return close;
    });

    revalidatePath(CAISSE_PATH);
    return { ok: true, id: session.id };
  } catch (error) {
    if (error instanceof Error) return { ok: false, error: error.message };
    throw error;
  }
}

// ── Journal Z ───────────────────────────────────────────────────────────

export type JournalZ = {
  session: SessionCaisse;
  pharmacyName: string;
  identifiantFiscal: string | null;
  ice: string | null;
  totaux: ReturnType<typeof totauxZ>;
  paiements: VentilationPaiement;
  tva: LigneTva[];
  /** Ventes rattachées après coup, dont la date réelle est antérieure. */
  rattrapagesOffline: number;
};

export async function getJournalZ(sessionId: string): Promise<JournalZ | null> {
  const user = await requireUser();

  const ligne = await prisma.caisseSession.findFirst({
    where: { id: sessionId, pharmacyId: user.pharmacyId },
    include: INCLUDE_SESSION,
  });
  if (!ligne) return null;

  const [ventes, pharmacy, rattrapages] = await Promise.all([
    ventesDeLaSession(prisma, ligne.id),
    prisma.pharmacy.findUniqueOrThrow({
      where: { id: user.pharmacyId },
      select: { name: true, identifiantFiscal: true, ice: true },
    }),
    prisma.sale.count({ where: { caisseSessionId: ligne.id, rattrapageOffline: true } }),
  ]);

  return {
    session: toSession(ligne),
    pharmacyName: pharmacy.name,
    identifiantFiscal: pharmacy.identifiantFiscal,
    ice: pharmacy.ice,
    totaux: totauxZ(ventes),
    paiements: ventilationParPaiement(ventes),
    tva: ventilationTva(ventes),
    rattrapagesOffline: rattrapages,
  };
}

// ── Réglage du PIN ──────────────────────────────────────────────────────

export async function definirClotureAssistant(input: {
  autorisee: boolean;
  /** Requis pour activer, ignoré pour désactiver. */
  pin?: string;
}): Promise<ResultatCaisse> {
  const owner = await requireOwner();

  if (!input.autorisee) {
    // Le haché est effacé en même temps : laisser un PIN dormant
    // réactiverait l'accès au prochain basculement de l'interrupteur,
    // sans que personne ne l'ait ressaisi.
    await prisma.pharmacy.update({
      where: { id: owner.pharmacyId },
      data: { clotureAssistantAutorisee: false, cloturePinHash: null },
    });
    revalidatePath("/parametres");
    return { ok: true, id: owner.pharmacyId };
  }

  if (!input.pin || !pinValide(input.pin)) {
    return { ok: false, error: "Le code PIN doit comporter 4 à 6 chiffres." };
  }

  await prisma.pharmacy.update({
    where: { id: owner.pharmacyId },
    data: { clotureAssistantAutorisee: true, cloturePinHash: hacherPin(input.pin) },
  });

  revalidatePath("/parametres");
  return { ok: true, id: owner.pharmacyId };
}

// ── Le bandeau du comptoir ──────────────────────────────────────────────

export type ResumeSession = {
  sessionId: string;
  dateOuverture: Date;
  ouvreurNom: string;
  nombreVentes: number;
  /** CA TTC de la session, part organisme comprise. */
  caTtc: number;
};

/**
 * Ce que la bande de caisse affiche en permanence.
 *
 * Volontairement **sans les espèces**. Le comptage de clôture se fait à
 * l'aveugle : afficher toute la journée le montant que le tiroir devrait
 * contenir reviendrait à compter en sachant quoi trouver. Le nombre de
 * ventes et le CA renseignent le pharmacien sans lui donner la réponse.
 *
 * L'approximation subsiste dans une officine qui encaisse surtout en
 * liquide, où le CA suit de près le tiroir. C'est le prix de l'affichage,
 * assumé : voir sa journée est utile tous les jours, le comptage à
 * l'aveugle ne sert qu'au moment de la clôture.
 */
export async function getResumeSession(): Promise<ResumeSession | null> {
  const user = await requireUser();

  const session = await prisma.caisseSession.findFirst({
    where: { pharmacyId: user.pharmacyId, statut: "OUVERTE" },
    select: {
      id: true,
      dateOuverture: true,
      ouvreur: { select: { name: true } },
      _count: { select: { ventes: true } },
    },
  });
  if (!session) return null;

  const totaux = await prisma.sale.aggregate({
    where: { caisseSessionId: session.id },
    _sum: { totalAmount: true },
  });

  return {
    sessionId: session.id,
    dateOuverture: session.dateOuverture,
    ouvreurNom: session.ouvreur.name,
    nombreVentes: session._count.ventes,
    caTtc: Number(totaux._sum.totalAmount ?? 0),
  };
}
