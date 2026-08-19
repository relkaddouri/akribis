# Connexions à la base — les deux ports du pooler

## Le problème rencontré

```
PrismaClientKnownRequestError
(EMAXCONNSESSION) max clients reached in session mode
                 — max clients are limited to pool_size: 15
  at totalsFor (lib/server/dashboard-periods.ts:51)
```

Le tableau de bord lance une dizaine d'agrégations en parallèle. L'application
se connectait au pooler Supabase sur le **port 5432**, c'est-à-dire en **mode
session** : chaque client y garde une connexion serveur dédiée pour toute sa
durée de vie, sans jamais la rendre entre deux requêtes. Avec un `pool_size` de
15, le serveur de développement, ses rechargements à chaud et un script lancé
en parallèle suffisaient à tout consommer.

## La règle

| | Port | Mode | Pour quoi |
|---|---|---|---|
| `DATABASE_URL` | **6543** | transaction | l'application |
| `DIRECT_URL` | **5432** | session | les migrations Prisma |

- **6543 (transaction)** rend la connexion au pool entre deux requêtes. C'est
  ce qu'il faut à une application web, et ce qui permet de tenir bien plus de
  requêtes simultanées que de connexions.
- **5432 (session)** reste indispensable à `prisma migrate` : il pose un verrou
  d'avis puis enchaîne du DDL sur la même connexion, ce que le mode transaction
  ne garantit pas.

`prisma.config.ts` lit `DIRECT_URL` (avec repli sur `DATABASE_URL`), donc les
migrations empruntent le bon port sans qu'on ait à y penser.

## Vérifié

Le driver adapter Prisma (`PrismaPg`) fonctionne complètement en mode
transaction sur Supavisor : comptes, jointures et `$transaction` — testé avant
de basculer, parce que pgBouncer en mode transaction ne supporte
historiquement pas les requêtes préparées.

Après bascule : **90 requêtes simultanées** passent sans épuisement, là où 15
suffisaient à faire tomber la page.

## Le plafond du pool

`lib/db/client.ts` limite le pool `pg` à **5 connexions** (`DATABASE_POOL_MAX`
pour l'ajuster). Le défaut de `pg` est 10 : deux instances suffisaient à
dépasser les 15 du pooler. En mode transaction les connexions sont
multiplexées, donc un plafond serré ne coûte pratiquement rien en débit.

L'adaptateur est aussi construit **à l'intérieur** de la fonction de création,
pas en portée module : chaque rechargement à chaud réévalue le module, et un
`new PrismaPg()` en portée module fabriquait un pool de plus à chaque fois,
même quand le client était bien réutilisé depuis `globalThis`.

## À faire sur les environnements déployés

`.env` et `.env.staging` sont à jour. **Vercel ne l'est pas** : il faut y
répercuter la même chose, sinon la production gardera le mode session.

1. `DATABASE_URL` → remplacer `:5432/` par `:6543/`
2. Ajouter `DIRECT_URL` → l'URL d'origine, en `:5432/`
3. Redéployer

Sans `DIRECT_URL`, `prisma migrate deploy` retomberait sur `DATABASE_URL` en
mode transaction et échouerait au moment d'appliquer une migration.
