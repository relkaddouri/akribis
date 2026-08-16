# Migration vers le Catalogue Produits

État au 16 août 2026. Ce document décrit **exactement où s'arrête la phase 1**
pour que la phase suivante reprenne sans avoir à relire le code.

## En une phrase

Les trois nouvelles tables du PRD existent et sont peuplées à partir de
`products` ; **`products` reste la seule table que le code applicatif lit et
écrit**. Rien n'a basculé.

## Ce que la phase 1 a fait

| | |
|---|---|
| Schéma | 3 modèles + 2 enums ajoutés dans `prisma/schema.prisma` |
| Migration SQL | `prisma/migrations/20260816163338_catalogue_produits/` — **purement additive**, aucune référence à `products` |
| Données | `prisma/migrate-catalogue.ts`, rejouable, exécuté sur staging |
| Contrôle | `prisma/verify-catalogue.ts`, exécuté, aucune incohérence |
| Code applicatif | **inchangé** — aucune route, aucun composant, aucune requête touchés |

## Le modèle en trois niveaux

```
CatalogueProduit          national, partagé, sans pharmacyId
      │                   nom, DCI, forme, PPH/PPV, TVA, monographie…
      │                   dédoublonné par code_barres (unique)
      ▼
PharmacyStock             ce qu'UNE officine décide pour CE produit
      │                   stock minimum, emplacement, fournisseur, prix d'achat
      │                   unique (pharmacy_id, catalogue_produit_id)
      ▼
ProductLot                les unités réelles
                          numéro de lot, quantité, date de péremption
```

**`PharmacyStock` n'a pas de colonne quantité.** C'est délibéré, et c'est le
point du PRD le plus facile à casser par inadvertance : la quantité disponible
est `SUM(product_lots.quantite)` pour cette ligne de stock. Ajouter une colonne
`quantite` sur `pharmacy_stock` créerait deux vérités qui divergeraient au
premier bug de synchronisation.

Le tri FEFO se fait sur `product_lots.date_peremption` (indexée), pas sur une
date portée par le produit.

## Deux écarts assumés par rapport à la liste du PRD

Les deux sont documentés dans le schéma, à l'endroit du champ.

1. **`CatalogueProduit.dosage`** — la section 5.1 fait du dosage une partie du
   « Nom ». `products.dosage` existe déjà comme colonne distincte, et le
   référentiel CNOPS le fournit séparément (`DOSAGE1` / `UNITE_DOSAGE1`). Le
   fondre dans le nom aurait perdu de l'information dès la migration.

2. **`PharmacyStock.prixAchat`** — absent de la liste 5.2, mais imposé par la
   section 9 (calcul de marge). Le prix d'achat réellement facturé est propre à
   l'officine et se distingue du PPH réglementé du catalogue. Sans ce champ,
   `products.purchasePrice` serait perdu.

## Comment les colonnes ont été réparties

| `products` | destination | remarque |
|---|---|---|
| `name`, `form`, `dosage`, `dci`, `laboratory`, `barcode`, `photoUrl` | `catalogue_produits` | tel quel |
| `category` | `classe_therapeutique` | **pas** `categorie` : la colonne contient des classes thérapeutiques (« Antalgiques / Antipyrétiques »), pas la catégorie du PRD |
| `price` | `ppv` | **approximation** — le PPV est réglementé et national, ce prix a été saisi par une officine |
| `pph`, `tvaVente`, `tvaAchat`, `remboursable` | `catalogue_produits` | tel quel |
| `baseRemboursement` | `prix_base_remboursement` | c'est un **montant**, pas le taux ; `taux_remboursement` reste nul |
| `posologie*`, `monographie` | `catalogue_produits` | tel quel |
| `photoUrl` | `catalogue_produit_photos` (ordre 0) | devient la photo principale — voir ci-dessous |
| `purchasePrice` | `pharmacy_stock.prix_achat` | propre à l'officine |
| `lowStockThreshold` | `pharmacy_stock.stock_minimum` | propre à l'officine |
| `quantityInStock` | `product_lots.quantite` | un seul lot, portant toute la quantité |
| `nearestExpiryDate` | `product_lots.date_peremption` | la date appartient au lot |

`categorie` (pharmaceutique / para / dispositif) reste **NULL** partout :
l'information n'existait nulle part dans `products`, elle détermine le taux de
TVA, et une valeur inventée aurait été pire que son absence. Le script de
contrôle la signale comme « à compléter ».

L'id du produit devient l'id de sa fiche catalogue quand celle-ci est créée :
le lien reste traçable, et rejouer le script retombe sur la même ligne.

## Photos : une table, plus une colonne

`catalogue_produits.photo_url` a été remplacée par **`catalogue_produit_photos`**
(`id`, `catalogue_produit_id`, `url`, `ordre`, `date_ajout`), migration
`20260816191750_catalogue_photos`. Les trois étapes y sont dans cet ordre :
créer la table, **reprendre l'existant**, puis seulement retirer la colonne —
Prisma avait généré le `DROP COLUMN` en premier, ce qui aurait effacé les
photos avant d'avoir de quoi les recevoir.

- `ordre` porte la notion de **photo principale** : la plus basse. Pas de
  contrainte d'unicité dessus, sinon réordonner par échange serait bloqué par
  l'état transitoire à deux photos de même rang.
- La position dans la liste du formulaire *est* l'ordre. `renumber()` recalcule
  `ordre` à chaque enregistrement, donc « première de la liste » et « photo
  principale » ne peuvent pas diverger.
- Suppression en cascade depuis la fiche.
- Stockage : bucket `catalogue-photos`, **lecture publique, écriture refusée à
  la clé anon** (aucune policy RLS d'insertion) ; seule la clé service-role
  écrit, et uniquement derrière `requireAdmin()`. Le bucket refuse lui-même
  tout MIME hors jpg/png/webp et tout fichier au-delà de 5 Mo.
- Limites : **6 photos par fiche, 5 Mo par fichier** — justifiées dans
  `lib/catalogue/photo-rules.ts`.

À reprendre en phase suivante : une photo retirée du formulaire n'est pas
supprimée du bucket (l'objet devient orphelin). C'est délibéré — la supprimer
tout de suite casserait la fiche de qui abandonne ensuite le formulaire — mais
un nettoyage périodique des objets non référencés reste à écrire.

## Idempotence

Les trois étapes peuvent être rejouées sans dommage :

- catalogue : recherche préalable sur `code_barres` ;
- stock : `ON CONFLICT (pharmacy_id, catalogue_produit_id) DO NOTHING` ;
- lots : recherche du numéro sentinelle `MIGRATION-INITIALE`.

Le tout dans une transaction : une migration à moitié appliquée laisserait des
lignes de stock sans lot, donc des quantités à zéro.

Vérifié sur staging — le second passage crée 0 ligne et compte 1 ligne de stock
et 1 lot « déjà là ».

## Commandes

```bash
npm run migrate:catalogue -- --dry-run   # n'écrit rien, affiche le plan
npm run migrate:catalogue
npm run verify:catalogue                 # lecture seule, sort en 1 si écart
```

`verify:catalogue` répond à quatre questions : chaque produit a-t-il une ligne
de stock, chaque ligne de stock au moins un lot, la quantité totale est-elle
conservée (`sum(products.quantity_in_stock)` = `sum(product_lots.quantite)`),
reste-t-il des codes-barres en double.

## Résultat sur staging

```
products                      1
pharmacy_stock                1
catalogue_produits référencés 1
product_lots                  1
quantité totale               294 → 294
✓ Aucune incohérence.
```

Un signalement non bloquant : 1 fiche sans `categorie`.

Le volume est faible parce que la base staging l'est. **Ne pas en conclure que
le script tient à l'échelle de la production** : il boucle produit par produit,
avec 3 à 5 allers-retours SQL chacun. Au-delà de quelques milliers de produits,
le regrouper en insertions par lot avant de le lancer sur la base réelle.

## Ce qui reste à faire — phase suivante

Par ordre de dépendance :

1. **Basculer les lectures.** `lib/server/products.ts`, `stock.ts`,
   `inventory.ts`, `sales.ts`, `orders.ts` lisent encore `products`. La
   quantité devient une agrégation de lots — c'est le changement le plus
   invasif, et il touche le POS.
2. **Basculer les écritures**, réception et inventaire en tête : une réception
   crée désormais un *lot*, elle n'incrémente plus un compteur.
3. **Décrémenter en FEFO à la vente**, au lieu de décrémenter un total.
4. **Adapter la couche hors-ligne** (`lib/offline/`) : le schéma Dexie et la
   file d'écriture reflètent la forme actuelle de `products`.
5. **Compléter `categorie`** sur les fiches existantes (interface Admin), sans
   quoi la TVA ne peut pas être déduite.
6. **Importer le référentiel CNOPS** pour peupler le catalogue national.
7. **Retirer `products`** — en dernier, une fois 1 à 4 vérifiés en production.

Tant que 1 et 2 ne sont pas faits, les nouvelles tables **divergent** dès
qu'une vente a lieu : `products.quantityInStock` bouge, les lots non. Relancer
`migrate:catalogue` ne les rattrapera pas — le script ne met rien à jour, il ne
fait qu'insérer ce qui manque. C'est acceptable sur staging ; ça ne le serait
pas en production, donc **ne pas lancer cette migration en production avant que
la phase 2 soit prête à suivre immédiatement**.
