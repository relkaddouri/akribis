import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

/**
 * Le client Prisma de l'application.
 *
 * `DATABASE_URL` pointe sur le pooler Supabase en **mode transaction**
 * (port 6543), pas en mode session (5432). En mode session chaque client
 * garde une connexion serveur dédiée pour toute sa durée de vie : avec un
 * `pool_size` de 15, le serveur de dev, les rechargements à chaud et un
 * script lancé en parallèle suffisaient à l'épuiser, et le tableau de bord
 * tombait sur `EMAXCONNSESSION — max clients reached in session mode`.
 * Le mode transaction rend la connexion au pool entre deux requêtes.
 *
 * Les migrations, elles, continuent d'exiger le mode session : elles
 * passent par `DIRECT_URL` — voir prisma.config.ts.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Plafond volontairement bas. Le pool `pg` ouvre jusqu'à 10 connexions par
 * défaut ; en développement, deux instances suffisaient alors à dépasser
 * les 15 du pooler. En mode transaction ces connexions sont multiplexées,
 * donc un plafond serré ne coûte pratiquement rien en débit.
 */
const POOL_MAX = Number(process.env.DATABASE_POOL_MAX ?? 5);

function createClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: POOL_MAX }),
  });
}

/**
 * L'adaptateur est créé DANS cette fonction, pas au niveau du module :
 * chaque rechargement à chaud réévalue le module, et un `new PrismaPg()`
 * en portée module fabriquait un pool de plus à chaque fois, même quand
 * le client, lui, était bien réutilisé depuis `globalThis`.
 */
export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
