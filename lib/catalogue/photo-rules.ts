/**
 * Limits and formats for catalogue photos, shared by the upload action
 * and the picker so the browser refuses a file for exactly the same
 * reasons the server would.
 *
 * **6 photos, 5 Mo each.** A catalogue fiche is a product identity sheet,
 * not a gallery: box front, box back, the blister, the leaflet, and two
 * spare — past that, whoever is at the counter scrolls instead of
 * recognising. 5 Mo is roughly four times what a phone photo of a box
 * weighs once compressed, so it never rejects a legitimate picture while
 * still stopping someone dropping in a print-resolution scan. Both are
 * enforced server-side too, since a client check is only a courtesy.
 */

/**
 * The Supabase Storage bucket. Here rather than next to the upload action:
 * a `"use server"` module may only export async functions, and a plain
 * `export const` in one fails the build (though not `tsc`).
 */
export const CATALOGUE_PHOTO_BUCKET = "catalogue-photos";

export const MAX_CATALOGUE_PHOTOS = 6;
export const MAX_CATALOGUE_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * jpg, png, webp. No SVG on purpose: it is a document that can carry
 * script, and it would be served from a public bucket on our own origin.
 * No HEIC either — Safari would show it and nothing else would.
 */
export const CATALOGUE_PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** For the file picker's `accept` attribute. */
export const CATALOGUE_PHOTO_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

export function formatMegabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} Mo`;
}

export function extensionForMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/** Returns null when the file is acceptable, otherwise why it isn't. */
export function rejectionReason(file: { type: string; size: number; name: string }): string | null {
  if (!(CATALOGUE_PHOTO_MIME_TYPES as readonly string[]).includes(file.type)) {
    return `${file.name} : format non accepté (jpg, png ou webp uniquement).`;
  }
  if (file.size > MAX_CATALOGUE_PHOTO_SIZE_BYTES) {
    return `${file.name} : ${formatMegabytes(file.size)}, la limite est de ${formatMegabytes(
      MAX_CATALOGUE_PHOTO_SIZE_BYTES,
    )}.`;
  }
  if (file.size === 0) {
    return `${file.name} : fichier vide.`;
  }
  return null;
}

export type CataloguePhotoInput = { url: string; ordre: number };

/**
 * Renumbers a list 0..n-1 after an insertion, a removal or a move, and
 * drops anything beyond the cap. Order in the array is the truth; `ordre`
 * is derived from it, never edited by hand — which is what keeps "first
 * in the list" and "photo principale" from ever disagreeing.
 */
export function renumber(urls: string[]): CataloguePhotoInput[] {
  return urls
    .slice(0, MAX_CATALOGUE_PHOTOS)
    .map((url, index) => ({ url, ordre: index }));
}

/** Moves the item at `from` to `to`, returning a new array. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/**
 * The photo a list or the POS should show. Lowest `ordre` wins; ties break
 * on the oldest, so the answer is stable rather than whatever the database
 * happened to return first.
 */
export function principalPhoto<T extends { url: string; ordre: number; dateAjout?: Date | string }>(
  photos: T[] | null | undefined,
): T | null {
  // Nullish, not just empty: a record can reach a list component without
  // the relation loaded — an older cached RSC payload, a query that forgot
  // the `include`. "No photo" must render the neutral tile in every one of
  // those cases, never throw. Types alone don't hold at a cache boundary.
  if (!photos || photos.length === 0) return null;
  return [...photos].sort((a, b) => {
    if (a.ordre !== b.ordre) return a.ordre - b.ordre;
    const dateA = a.dateAjout ? new Date(a.dateAjout).getTime() : 0;
    const dateB = b.dateAjout ? new Date(b.dateAjout).getTime() : 0;
    return dateA - dateB;
  })[0]!;
}
