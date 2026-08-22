"use server";

/**
 * Read/write facade for clients — same seam as lib/offline/products.ts,
 * meant to be swapped for an IndexedDB-backed implementation later.
 *
 * Named `addClient` rather than `createClient` on purpose: that name is
 * already used by the Supabase client factories in lib/supabase/*, and
 * this file is often imported alongside session helpers that pull those
 * in transitively.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import {
  clientEditSchema,
  clientFormSchema,
  type ClientEditInput,
  type ClientFormInput,
} from "@/lib/validations/clients";
import { ENTITES, journaliser, TYPES_ACTION } from "@/lib/audit/event-log";
import type { TypeClientValue } from "@/lib/validations/clients";
import type { ClientModel } from "@/lib/db/generated/models";

type DecimalField = "solde" | "plafondCredit";

/**
 * Les membres d'énumération Prisma sont en MAJUSCULES, la base et
 * l'interface en minuscules — même bascule que `toDbType`/`toUiType` dans
 * lib/server/client-account.ts.
 */
function typeClientVersDb(valeur: TypeClientValue) {
  return valeur.toUpperCase() as "REGULIER" | "OCCASIONNEL" | "PROFESSIONNEL";
}

function typeClientVersUi(valeur: string): TypeClientValue {
  return valeur.toLowerCase() as TypeClientValue;
}

/**
 * Prisma `Decimal` n'est pas une valeur JSON — `solde` est aplati en nombre
 * à cette frontière, comme dans les autres façades.
 *
 * Sans cette conversion, la valeur ne lève pas : elle arrive dans le
 * navigateur en **chaîne de caractères**, silencieusement. `solde * 2`
 * fonctionne alors par coercition, mais `solde + paiement` concatène
 * ("0.00" + 100 = "0.00100"), `solde.toFixed(2)` échoue, et un tri se fait
 * dans l'ordre alphabétique. Sur un solde client, ce sont des dirhams.
 */
export type ClientRecord = Omit<ClientModel, DecimalField | "typeClient"> & {
  solde: number;
  typeClient: TypeClientValue;
  /** `null` = aucun plafond fixé. Zéro en est un — voir lib/clients/plafond.ts. */
  plafondCredit: number | null;
};

function toClientRecord(client: ClientModel): ClientRecord {
  // Même forme que lib/catalogue/record.ts : le nullable passe par un
  // `decimal()` local plutôt que par un ternaire, ce qui garde la
  // conversion sur la ligne du champ — c'est là que
  // tests/admin/decimal-serialisation.test.ts la cherche.
  const decimal = (valeur: ClientModel["plafondCredit"]) =>
    valeur !== null && valeur !== undefined ? Number(valeur) : null;

  return {
    ...client,
    solde: Number(client.solde),
    typeClient: typeClientVersUi(client.typeClient),
    plafondCredit: decimal(client.plafondCredit),
  };
}

/**
 * L'instantané que le journal conserve.
 *
 * Volontairement partiel : `solde` et `pointsFidelite` bougent à chaque
 * vente sans que personne n'ait touché la fiche, et les archiver ferait
 * apparaître des « modifications » qu'aucun humain n'a commises. Le nom
 * est repris sous la clé `nom` parce que c'est celle que l'écran du
 * journal lit pour nommer la cible.
 */
function instantaneClient(client: ClientModel) {
  return {
    nom: client.name,
    phone: client.phone,
    email: client.email,
    typeClient: client.typeClient,
    cin: client.cin,
    medecinTraitant: client.medecinTraitant,
    adresse: client.adresse,
    codePostal: client.codePostal,
    ville: client.ville,
    pays: client.pays,
    numeroImmatriculation: client.numeroImmatriculation,
    insurerId: client.insurerId,
    plafondCredit: client.plafondCredit,
  };
}

export type ListClientsParams = {
  /** Matches against name and phone (case-insensitive). */
  search?: string;
};

export async function listClients(
  params: ListClientsParams = {},
): Promise<ClientRecord[]> {
  const user = await requireUser();
  const search = params.search?.trim();

  const clients = await prisma.client.findMany({
    where: {
      pharmacyId: user.pharmacyId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { phone: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
  });

  return clients.map(toClientRecord);
}

export type ClientPurchase = {
  saleId: string;
  createdAt: Date;
  totalAmount: number;
  paymentMethod: string;
  items: Array<{
    id: string;
    productName: string;
    quantity: number;
    unitPrice: number;
  }>;
};

export type ClientWithHistory = ClientRecord & { purchases: ClientPurchase[] };

/**
 * Purchase history comes from this client's sales, each with its line items.
 *
 * **La lecture est journalisée** (`client.consultation`), ce qui n'est le
 * cas d'aucune autre entité de l'application. La fiche porte le CIN et le
 * médecin traitant : la loi 09-08 traite ces données comme sensibles, et
 * un contrôle CNDP demande qui les a consultées, pas seulement qui les a
 * modifiées. L'entrée est écrite après coup, jamais avant : journaliser
 * une consultation qui n'a rien renvoyé — fiche absente, ou appartenant à
 * une autre officine — inventerait un accès qui n'a pas eu lieu.
 */
export async function getClient(id: string): Promise<ClientWithHistory | null> {
  const user = await requireUser();

  const client = await prisma.client.findFirst({
    where: { id, pharmacyId: user.pharmacyId },
    include: {
      sales: {
        orderBy: { createdAt: "desc" },
        include: {
          items: { include: { product: { select: { name: true } } } },
        },
      },
    },
  });
  if (!client) return null;

  const { sales, ...clientFields } = client;

  await journaliser(prisma, {
    acteur: { id: user.id, email: user.email, role: user.role },
    typeAction: TYPES_ACTION.clientConsultation,
    entite: ENTITES.client,
    entiteId: client.id,
    pharmacyId: user.pharmacyId,
    // Ni avant ni après : une lecture ne change rien. Le nom seul, pour
    // que le journal reste lisible si la fiche disparaît ensuite.
    apres: { nom: client.name },
  });

  return {
    ...toClientRecord(clientFields),
    purchases: sales.map((sale) => ({
      saleId: sale.id,
      createdAt: sale.createdAt,
      totalAmount: Number(sale.totalAmount),
      paymentMethod: sale.paymentMethod,
      items: sale.items.map((item) => ({
        id: item.id,
        productName: item.product.name,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
      })),
    })),
  };
}

export async function addClient(input: ClientFormInput): Promise<ClientRecord> {
  const user = await requireUser();
  const data = clientFormSchema.parse(input);

  const client = await prisma.client.create({
    data: {
      pharmacyId: user.pharmacyId,
      name: data.name,
      phone: data.phone,
    },
  });

  revalidatePath("/dashboard/clients");
  return toClientRecord(client);
}

/**
 * La mise à jour depuis la fiche — le seul endroit où se saisissent les
 * champs étendus.
 *
 * L'entrée de journal est écrite **dans la même transaction** que
 * l'écriture qu'elle décrit : une modification enregistrée sans sa trace
 * serait un trou dans le journal, et un journal troué ne se distingue pas
 * d'un journal faux.
 */
export async function updateClient(
  id: string,
  input: ClientEditInput,
): Promise<ClientRecord> {
  const user = await requireUser();
  const data = clientEditSchema.parse(input);

  const avant = await prisma.client.findFirst({
    where: { id, pharmacyId: user.pharmacyId },
  });
  if (!avant) throw new Error("Client introuvable");

  // L'organisme doit appartenir à cette officine : l'identifiant vient du
  // navigateur, et rien n'empêche d'en poster un autre.
  if (data.insurerId !== null) {
    const organisme = await prisma.organismeTiersPayant.findFirst({
      where: { id: data.insurerId, pharmacyId: user.pharmacyId },
      select: { id: true },
    });
    if (!organisme) throw new Error("Organisme inconnu");
  }

  const client = await prisma.$transaction(async (tx) => {
    const apres = await tx.client.update({
      where: { id },
      data: { ...data, typeClient: typeClientVersDb(data.typeClient) },
    });

    await journaliser(tx, {
      acteur: { id: user.id, email: user.email, role: user.role },
      typeAction: TYPES_ACTION.clientModifie,
      entite: ENTITES.client,
      entiteId: id,
      pharmacyId: user.pharmacyId,
      avant: instantaneClient(avant),
      apres: instantaneClient(apres),
    });

    return apres;
  });

  revalidatePath("/dashboard/clients");
  revalidatePath(`/dashboard/clients/${id}`);
  return toClientRecord(client);
}
