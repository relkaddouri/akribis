# Déploiement et migrations

Trois bases distinctes, jamais interchangeables :

| Environnement | Base | Déclenché par |
|---|---|---|
| Développement | Projet Supabase local ou personnel | Votre machine |
| Staging | Projet Supabase de staging | Déploiements *Preview* Vercel (branches) |
| Production | Projet Supabase de production | Déploiements *Production* Vercel (`main`) |

Chaque environnement a son propre jeu de variables dans **Vercel → Settings →
Environment Variables**, coché pour le bon *scope*. Rappel qui a déjà coûté un
déploiement : les variables `NEXT_PUBLIC_*` sont **figées dans le bundle au
moment du build**. Les ajouter ou les corriger après coup n'a aucun effet tant
que le projet n'est pas redéployé.

---

## 1. Comment les URLs de base sont configurées

**Ce projet est en Prisma 7.** Le motif `url` + `directUrl` dans
`schema.prisma`, encore largement documenté en ligne, **n'existe plus** :

```
error: The datasource property `url` is no longer supported in schema files.
error: The datasource property `directUrl` is no longer supported in schema files.
       Move connection URLs to `prisma.config.ts`.
```

La configuration réelle est répartie sur deux endroits :

- **`prisma.config.ts`** → `datasource.url` (lue par la **CLI** : `migrate`,
  `db execute`, `studio`). Aujourd'hui : `process.env.DATABASE_URL`.
- **`lib/db/client.ts`** → `new PrismaPg({ connectionString: process.env.DATABASE_URL })`
  (lue par l'**application** à l'exécution, via le driver adapter).

Ce sont deux chemins indépendants qui lisent la même variable. C'est ce qui
rend la séparation ci-dessous possible sans toucher au schéma.

### Option A — une seule URL (état actuel)

`DATABASE_URL` sert à la fois à l'application et aux migrations. Elle pointe
aujourd'hui sur le **pooler en port 5432** (mode *session*).

- **Pour** : rien à configurer, les migrations fonctionnent.
- **Contre** : le mode session garde une connexion ouverte par client. Sur des
  fonctions serverless qui montent en charge, c'est le mode le moins économe —
  Supabase recommande le mode *transaction* (port 6543) pour l'application.

### Option B — séparer application et migrations

Deux variables :

```
DATABASE_URL=…pooler.supabase.com:6543/postgres?pgbouncer=true   # application
MIGRATE_DATABASE_URL=…pooler.supabase.com:5432/postgres          # CLI Prisma
```

et dans `prisma.config.ts` :

```ts
datasource: {
  url: process.env["MIGRATE_DATABASE_URL"] ?? process.env["DATABASE_URL"],
}
```

- **Pour** : l'application utilise le pooler *transaction*, adapté au
  serverless ; les migrations passent par le pooler *session*, qui les
  supporte.
- **Contre** : une variable de plus à renseigner dans chaque environnement.
  Oubliée, la CLI retombe sur `DATABASE_URL` — ce qui échoue de façon
  déroutante si celle-ci est en mode transaction (`prepared statement
  already exists`).

> **À trancher.** L'option A fonctionne aujourd'hui. L'option B est le motif
> recommandé par Supabase pour une application serverless. Le passage de A à B
> est réversible et ne touche ni le schéma ni les migrations existantes.

---

## 2. Le cycle d'une modification de schéma

### 2.1 En développement — créer la migration

```bash
npm run dev            # laisser tourner, ou l'arrêter : sans importance
npx prisma migrate dev --name description_courte
```

Cela crée `prisma/migrations/<horodatage>_description_courte/migration.sql`,
l'applique à votre base de développement, et régénère le client.

**Si Prisma annonce une perte de données**, il refuse et propose un reset.
**Ne jamais accepter le reset sur une base partagée.** Écrire le SQL à la main
dans le dossier de migration est la bonne réponse — c'est ce qui a été fait
pour `_order_delivery_credit` et `_supplier_credit_remaining`. Un renommage de
colonne écrit à la main préserve les données ; le SQL généré les supprime et
les recrée.

Commiter le dossier de migration **avec** le changement de code qui en dépend.

### 2.2 Sur staging — avant de merger

```bash
npm run migrate:status:staging   # ce qui est en attente
npm run migrate:staging          # applique (prisma migrate deploy)
```

Ces deux commandes lisent `.env.staging` via `--env-file` de Node, jamais
`.env`. Elles n'inventent aucune migration : `deploy` applique ce qui existe
dans `prisma/migrations`, sans jamais rien générer ni réinitialiser.

Déployez ensuite la branche sur Vercel (Preview) et vérifiez l'application
contre staging **avant** d'ouvrir la merge request.

### 2.3 Sur production — après le merge vers `main`

Deux options, à trancher :

#### Option 1 — application manuelle (recommandée pour l'instant)

```bash
npm run migrate:status:staging   # adapter à .env.production
ALLOW_PRODUCTION_SEED=oui …      # uniquement si un seed est nécessaire
```

Concrètement : une commande `migrate:production` symétrique, lancée à la main
juste **avant** que le déploiement Vercel ne bascule.

- **Pour** : vous voyez le SQL avant qu'il ne s'exécute, vous choisissez le
  moment (hors heures d'ouverture de la pharmacie), et une migration qui échoue
  ne bloque pas le déploiement de code.
- **Contre** : c'est une étape qu'on oublie. Une migration non appliquée avec
  du code qui l'attend donne des erreurs `column does not exist` en production.

#### Option 2 — application automatique au build

Ajouter `prisma migrate deploy` au script `build`.

- **Pour** : impossible d'oublier ; le schéma et le code avancent ensemble.
- **Contre** : un build Vercel qui échoue au milieu d'une migration laisse la
  base dans un état partiel, sans personne devant l'écran. Vercel peut aussi
  lancer plusieurs builds en parallèle sur la même base. Et une migration
  destructive part sans relecture — le mécanisme même qui aurait dû être vu.

> **Recommandation.** Manuel tant que la pharmacie a des heures d'ouverture et
> qu'il n'y a pas de sauvegarde automatisée vérifiée. L'automatisation devient
> raisonnable quand un `pg_dump` précède chaque migration et qu'un rollback est
> testé.

### 2.4 Ordre des déploiements

Une migration et le code qui en dépend n'atteignent jamais la production au
même instant. Pour que l'écart soit sans conséquence :

- **Ajout** de colonne ou de table → migrer **avant** de déployer le code.
- **Suppression** de colonne → déployer d'abord le code qui ne l'utilise plus,
  migrer **ensuite**.
- **Renommage** → jamais en une fois. Ajouter la nouvelle, déployer le code qui
  écrit dans les deux, remplir, déployer le code qui ne lit que la nouvelle,
  puis supprimer l'ancienne.

---

## 3. Garde-fous contre une écriture accidentelle

Les scripts de seed lisent `DATABASE_URL` depuis le fichier `.env` présent sur
le disque. Avec une seule base c'était sans risque ; avec staging **et**
production, la même commande écrit dans celle que le fichier désigne à cet
instant, et rien à l'écran ne dit laquelle.

Chaque fichier d'environnement doit donc porter une étiquette :

```
DB_ENVIRONMENT=staging      # ou development, ou production
```

Le garde (`prisma/seed-guard.ts`) s'exécute **avant toute connexion** :

| Situation | Comportement |
|---|---|
| `DB_ENVIRONMENT` absent | **Refus**, en affichant l'hôte visé |
| Étiquette non reconnue (`prod`, `stg`…) | **Refus** — un typo ne doit pas passer pour « pas la production » |
| `development` ou `staging` | Autorisé, hôte affiché |
| `production` | **Refus** sauf `ALLOW_PRODUCTION_SEED=oui` |

L'hôte est toujours affiché, jamais le mot de passe — ces lignes finissent dans
l'historique du terminal et dans les logs de CI.

---

## 4. Lancer un seed contre staging

```bash
npm run seed:publications:staging
```

Cette commande lit **`.env.staging`** via `--env-file` de Node, qui l'emporte
sur `dotenv/config` du script (dotenv n'écrase jamais une variable déjà
définie). Il n'y a donc aucun chemin par lequel elle atteindrait `.env`.

Pour vérifier ce qui serait écrit, sans ouvrir de connexion :

```bash
npm run seed:publications -- --dry-run
```

### Fichier `.env.staging`

Non versionné (`.gitignore` couvre `.env*`), à créer à la main :

```
DATABASE_URL="postgresql://…projet-staging…:5432/postgres"
DB_ENVIRONMENT="staging"
NEXT_PUBLIC_SUPABASE_URL="https://…-staging.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="…"
SUPABASE_SERVICE_ROLE_KEY="…"
```

### Le compte titulaire de test

**Il n'existe aucun script pour cela.** Le compte `owner@akribis.test` a été
créé à la main dans Supabase (Auth + ligne `users` + `pharmacies`, liées entre
elles). Sur une nouvelle base de staging il faudra refaire cette opération à la
main, ou écrire le script — qui devra passer par l'Admin API Supabase avec
`SUPABASE_SERVICE_ROLE_KEY`, et poser `role` et `pharmacy_id` dans
`app_metadata` (jamais `user_metadata` : seul le premier est inaccessible à
l'utilisateur lui-même).

---

## 5. Points restés ouverts

- **Sauvegardes.** Aucune vérification de restauration n'a été faite. Tant que
  ce n'est pas le cas, l'application manuelle des migrations (§2.3, option 1)
  est le seul filet.
- **Migration de production.** Aucun script `migrate:production` n'est fourni
  volontairement : il demande un fichier `.env.production` sur la machine de
  l'opérateur, ce qui est une décision à prendre en connaissance de cause.
