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

## Phase 3 — l'ajout au stock part du catalogue

`products.catalogue_produit_id` (migration `20260816235334_product_catalogue_link`,
additive, avec rattachement des produits existants par id puis par code-barres).

Le bouton « Ajouter un produit » ouvre désormais une recherche dans le
catalogue, puis un formulaire réduit aux seuls champs de l'officine
(fournisseur, quantité, seuil, prix d'achat, référence interne,
emplacement). La validation crée **à la fois** la ligne `products` — qui
reste la table opérationnelle — et la ligne `pharmacy_stock`, plus un
mouvement de stock d'entrée.

**Ce qui n'a délibérément pas changé** : le POS, la vente, le retour, la
réception et l'inventaire lisent et écrivent toujours `products`. Deux
raisons, décidées avec le titulaire :

- `pharmacy_stock` n'a pas de quantité (elle dérive des lots), alors que la
  vente décrémente `products.quantity_in_stock` ;
- le POS cherche dans IndexedDB, ce qui permet de vendre hors ligne. Une
  jointure serveur supprimerait cette propriété.

La source des données produit est donc bien le catalogue — les fiches en
sont désormais *issues* — sans toucher aux flux qui les consomment.

Les prix réglementés sont **copiés** dans `products` à la création, pas
référencés : c'est un instantané, pour qu'un changement national ne
réécrive pas en silence le prix de vente d'une officine avant que cette
décision ait un propriétaire.

Le formulaire manuel complet reste à `/dashboard/stock/produits/nouveau/manuel`,
atteignable quand le catalogue ne trouve rien ou que le réseau est coupé.
« Suggérer ce produit » n'est qu'un point d'entrée : le flux de suggestion
est une phase à part.

## Correctif de conception — `pharmacy_stock` devient une copie complète

**Ce qui change par rapport à la phase 1 telle qu'écrite plus haut.** La
phase 1 avait donné à `pharmacy_stock` uniquement les champs de l'officine,
et faisait lire identification, prix et descriptif à travers
`catalogue_produit_id`. Ce n'est plus la conception retenue.

`pharmacy_stock` porte désormais **une copie complète et modifiable** de la
fiche catalogue — les 34 colonnes de la section 5.1 — en plus de ses propres
champs. Migration `20260817012434_pharmacy_stock_full_copy` : purement
additive, un seul `ALTER TABLE`, 34 `ADD COLUMN`, aucun `DROP`, aucun
`NOT NULL`, aucun défaut posé.

Toutes les nouvelles colonnes sont **nullable**, y compris les booléens et
les enums. Ce n'est pas de la paresse : un `NULL` s'y lit « pas encore
recopié depuis le catalogue », et c'est précisément ce qui rend le backfill
rejouable sans risque.

`code_barres` est **non unique** ici, contrairement au catalogue : deux
officines stockent le même produit.

### Le backfill

```bash
npm run backfill:pharmacy-stock -- --dry-run
npm run backfill:pharmacy-stock
```

`prisma/backfill-pharmacy-stock.ts`. Le `SET` est engendré depuis une seule
liste de noms de colonnes, identiques des deux côtés — impossible d'apparier
PPH avec PPV, l'erreur classique d'un backfill écrit à la main.

**Rejouable, et non destructif.** Il ne cible que les lignes jamais recopiées
(`nom IS NULL`). Une officine qui a depuis corrigé sa copie ne la verra pas
écrasée par un second passage. C'est aussi la limite du script, par
construction : il ne resynchronise pas.

### Vérifié sur staging

| | |
|---|---|
| Lignes `pharmacy_stock` | 2 → 2 (inchangé) |
| Colonnes | 14 → 48 |
| Lignes recopiées | 2 |
| Écarts avec le catalogue après recopie | 0 sur 34 colonnes × 2 lignes |
| Rejeu | 0 ligne touchée |

**Indépendance prouvée** (transaction annulée) : modifier `pharmacy_stock`
laisse le catalogue intact ; modifier le catalogue laisse la copie de
l'officine intacte. Les champs propres à la pharmacie (`stock_minimum`,
`localisation`, `prix_achat`…) ne sont jamais touchés par le backfill.

### La règle pour la suite

`catalogue_produit_id` **reste**, mais uniquement comme lien de traçabilité :
savoir de quelle fiche nationale cette ligne est issue.

> Plus aucun code ne doit lire l'identification, les prix ou le descriptif à
> travers ce lien. Ces valeurs se lisent directement sur `pharmacy_stock`.

C'est écrit à l'endroit du champ dans `prisma/schema.prisma`, pour que la
règle se trouve là où on l'oublierait.

### Raccordement de l'action — fait

`addCatalogueProduitToStock` (`lib/server/stock-entry.ts`) remplit désormais
les 34 colonnes à la création de la ligne `pharmacy_stock`, et crée le lot
d'ouverture.

- **Les 34 colonnes.** `catalogueSnapshot(fiche)` les pose à la création. Sur
  une ligne préexistante (migration de phase 2), elles ne sont (re)copiées que
  si `nom` est nul — même marqueur que le backfill. Écraser ici annulerait en
  silence une correction faite par l'officine, ce que toute cette séparation
  existe précisément pour empêcher.
- **Le lot d'ouverture.** Numéro sentinelle `STOCK-INITIAL`, sur le modèle de
  `MIGRATION-INITIALE` : ces unités n'ont pas de numéro réel, il vient du
  Datamatrix à la première vraie réception. Créé seulement si la quantité
  initiale est > 0 — un lot de zéro unité ne décrit rien, et la somme vaut
  correctement zéro sans lui.

Vérifié en transaction annulée : **0 écart sur les 34 colonnes**, lot
`STOCK-INITIAL` créé, champs propres à l'officine (`stock_minimum`,
`localisation`) intacts.

La ligne SMECTA créée sur staging par la version défectueuse a été réparée
(son lot manquant ajouté). `npm run verify:catalogue` est de nouveau vert :

```
products 2 · pharmacy_stock 2 · product_lots 2
quantité totale 394 → 394
✓ Aucune incohérence.
```

### La copie appartient à la pharmacie

Décision actée, et elle change le sens de tout ce qui précède : le catalogue
est **un point de départ pratique, pas une source figée**. Une fois copiée,
chaque champ appartient à l'officine — prix, TVA et taux de remboursement
compris — et se modifie sans aucune validation Admin.

Conséquences dans l'interface :

- La fiche produit **ne sépare plus** « verrouillé » et « modifiable ». Le
  cadenas et la mention « lecture seule » ont été retirés : tout passe par le
  même bouton « Modifier ».
- Avant validation, le flux d'ajout affiche exactement ceci, sans autre
  promesse : *« Vérifiez ces informations avant de les ajouter à votre
  stock. »*
- Un bouton **« Mettre à jour depuis le catalogue »** est disponible à tout
  moment sur la fiche. `refreshFromCatalogue()` réimporte les valeurs
  actuelles — **uniquement sur clic explicite, jamais automatiquement**. Une
  resynchronisation silencieuse écraserait les corrections de la pharmacie
  sans que personne le remarque.

Le réimport écrase les champs produit et **rien d'autre**. Vérifié en
transaction annulée : après réimport, nom/prix/TVA reviennent aux valeurs du
catalogue, tandis que quantité (77), seuil (9), prix d'achat (55) et
emplacement (« MON RAYON ») restent ceux de l'officine.

### Le doublon qui reste à trancher

La même fiche existe en **trois exemplaires** — `catalogue_produits`,
`pharmacy_stock`, et `products` (que le flux d'ajout remplit aussi depuis le
catalogue). Deux copies opérationnelles pour une seule officine : soit
`products` disparaît au profit de `pharmacy_stock`, soit l'inverse. Le choix
n'a pas encore été fait, et tant qu'il ne l'est pas, **le flux d'ajout écrit
les deux** — c'est délibéré, mais ce n'est pas tenable durablement.


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
