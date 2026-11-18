/**
 * Marque le lot d'ouverture créé quand une officine ajoute un produit à son
 * stock, sur le modèle de `MIGRATION-INITIALE` : ces unités n'ont pas de
 * numéro de lot réel — il vient du Datamatrix à la première vraie réception.
 *
 * Ici plutôt qu'à côté de l'action qui l'utilise : un module `"use server"`
 * ne peut exporter que des fonctions async, et un `export const` y compile
 * sous `tsc` mais fait échouer le build de production.
 */
export const OPENING_LOT_NUMBER = "STOCK-INITIAL";
