# Vérifier la navigation hors ligne

La couche offline se teste à deux niveaux. Ce qui peut l'être automatiquement
l'est : `tests/offline/service-worker.test.ts` couvre les décisions de routage
du service worker, `tests/offline/last-known-counts.test.ts` la persistance des
compteurs. Ce document couvre le reste — ce qui exige une session connectée et
un vrai navigateur.

## Pourquoi une procédure manuelle

Le service worker n'est enregistré qu'en production (`NODE_ENV === "production"`),
parce qu'un worker qui met en cache les modules du serveur de développement
entre en conflit avec le rechargement à chaud et produit des bugs fantômes.
Les scénarios ci-dessous exigent donc un build de production, et une connexion
réelle à Supabase — que la suite de tests ne fait jamais.

## Préparation

```bash
npm run build && npm start
```

Ouvrez `http://localhost:3000`, connectez-vous, puis vérifiez dans les DevTools
que le worker est actif : **Application → Service Workers** doit afficher
`sw.js` en `activated and is running`.

> Après chaque modification de `public/sw.js`, incrémentez `VERSION` en tête du
> fichier. Sinon l'ancien worker reste actif et vous testez du code périmé.

## Scénario 1 — Rechargement hors ligne (F5)

1. En ligne, visitez **Stock**, puis **Caisse**. Chaque page visitée est mise en
   cache à ce moment-là ; une page jamais ouverte en ligne ne pourra pas
   s'afficher plus tard.
2. DevTools → **Network** → cochez **Offline**.
3. Rechargez (F5).

**Attendu** : la page se réaffiche avec la sidebar, le header et son contenu.
La bannière « Hors ligne » apparaît en bas.
**Régression** : la page d'erreur du navigateur (« Pas de connexion Internet »).

## Scénario 2 — Navigation Stock ↔ Caisse pendant la coupure

Toujours en mode Offline, cliquez sur **Stock** puis sur **Caisse** dans la
sidebar.

**Attendu** : les deux pages s'ouvrent. La console affichera
`Failed to fetch RSC payload… Falling back to browser navigation` — c'est le
mécanisme prévu, pas une erreur : Next abandonne la navigation client, le
navigateur redemande la page entière, et le service worker la sert depuis son
cache.

**À vérifier aussi** : la recherche de produits fonctionne (elle lit IndexedDB),
et une vente peut être encaissée avec le ticket imprimé.

## Scénario 3 — Compteurs de la sidebar

1. En ligne, notez les badges **Akribis actualités** et **Rappels**.
2. Passez en Offline et rechargez.

**Attendu** : les badges affichent les **mêmes** valeurs qu'en ligne.
**Régression** : les badges tombent à zéro ou disparaissent — un « 0 rappel »
inventé par une erreur réseau se lit comme « rien à faire aujourd'hui », ce qui
est pire qu'un chiffre daté.

Pour confirmer d'où vient la valeur :
`localStorage.getItem("akribis:last-known-counts")` — l'horodatage `updatedAt`
indique quand elle a été confirmée pour la dernière fois.

## Scénario 4 — Page jamais visitée hors ligne

Toujours en Offline, allez sur **Commandes** (en supposant que vous ne l'avez
pas ouverte depuis la connexion).

**Attendu** : redirection vers `/offline`, avec le message « Cette page n'est
pas disponible hors ligne » et des liens vers Caisse et Stock.
**Régression** : « Application error: a client-side exception has occurred ».
Cette erreur précise signifie que les chunks JS de `/offline` ne sont pas dans
le cache — vérifiez `precacheOfflineAssets` dans `public/sw.js`.

## Scénario 5 — Déconnexion

En ligne, déconnectez-vous, puis dans la console :

```js
await caches.keys()
```

**Attendu** : `akribis-pages-v1` a disparu, `akribis-static-v1` subsiste. Les
documents mis en cache ont été rendus pour un compte donné ; sur un poste
partagé, la personne suivante ne doit pas se voir servir le tableau de bord de
la précédente. Les assets statiques, eux, ne sont pas des données de compte.

## Ce qui reste sciemment non couvert

- **Commandes, Avoirs fournisseurs, Akribis actualités** ne fonctionnent pas
  hors ligne et ne sont pas censés le faire. Déjà visitées, elles s'affichent
  depuis le cache avec des données datées ; sinon elles redirigent vers
  `/offline`. La bannière prévient dans les deux cas.
- **Safari** : les scénarios ci-dessus ont été validés sur un navigateur
  Chromium. Safari implémente le Cache API mais formule ses erreurs réseau
  différemment (voir le bug ② du diagnostic, non corrigé à ce stade).
