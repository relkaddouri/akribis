import type { CatalogueProduitModel } from "@/lib/db/generated/models";

/**
 * La fiche catalogue telle qu'elle traverse la frontière serveur/client.
 *
 * Module ordinaire, et non `"use server"` : deux façades en ont besoin —
 * l'Admin (`lib/server/catalogue.ts`) et l'ajout au stock côté officine
 * (`lib/server/stock-entry.ts`) — et un fichier `"use server"` ne peut
 * exporter que des fonctions asynchrones. Une troisième recopie de cette
 * conversion serait la troisième occasion d'en oublier une colonne : c'est
 * déjà arrivé deux fois, avec `purchasePrice` puis `prixVenteIndicatif`.
 */

type DecimalField =
  | "pph"
  | "ppv"
  | "prixBaseRemboursement"
  | "tvaAchat"
  | "tvaVente"
  | "tauxRemboursement"
  | "prixVenteIndicatif";

export type CataloguePhotoRecord = { id: string; url: string; ordre: number };

/**
 * Prisma `Decimal` n'est pas du JSON — aplati en nombres à cette frontière.
 *
 * Ajouter une colonne `Decimal` au schéma sans l'ajouter ici produit une
 * erreur qui ne se voit qu'à l'exécution, sur la page qui la consomme :
 * « Only plain objects can be passed to Client Components ». Le test
 * tests/admin/decimal-serialisation.test.ts compare cette liste au schéma
 * et échoue si une colonne manque.
 */
export type CatalogueProduitRecord = Omit<CatalogueProduitModel, DecimalField> & {
  pph: number | null;
  ppv: number | null;
  prixBaseRemboursement: number | null;
  tvaAchat: number | null;
  tvaVente: number | null;
  tauxRemboursement: number | null;
  prixVenteIndicatif: number | null;
  /** Ordered, photo principale first. Empty when the fiche has none. */
  photos: CataloguePhotoRecord[];
};

type ProduitWithPhotos = CatalogueProduitModel & {
  photos?: { id: string; url: string; ordre: number }[];
};

export function toCatalogueRecord(produit: ProduitWithPhotos): CatalogueProduitRecord {
  const decimal = (value: CatalogueProduitModel[DecimalField]) =>
    value !== null && value !== undefined ? Number(value) : null;

  return {
    ...produit,
    pph: decimal(produit.pph),
    ppv: decimal(produit.ppv),
    prixBaseRemboursement: decimal(produit.prixBaseRemboursement),
    tvaAchat: decimal(produit.tvaAchat),
    tvaVente: decimal(produit.tvaVente),
    tauxRemboursement: decimal(produit.tauxRemboursement),
    prixVenteIndicatif: decimal(produit.prixVenteIndicatif),
    photos: produit.photos ?? [],
  };
}
