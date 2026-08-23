import { rgb, type PDFDocument, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { ICONE_AKRIBIS_PNG_BASE64 } from "@/lib/pdf/icone-akribis";

/**
 * Shared drawing primitives for the app's PDF documents (invoices, purchase
 * orders, …).
 *
 * pdf-lib is used throughout rather than pdfkit: it is pure JS with no
 * native bindings and no filesystem access, which is what makes it safe
 * inside a Next route handler — pdfkit needs its .afm font files on disk
 * and breaks once bundled.
 *
 * Extracted from the invoice renderer so a second document type reuses the
 * same layout helpers instead of copying them; every document should look
 * like it came from the same pharmacy.
 */

export const A4 = { width: 595.28, height: 841.89 };
export const MARGIN = 48;

export const INK = rgb(0.07, 0.09, 0.15);
export const MUTED = rgb(0.42, 0.45, 0.5);
export const RULE = rgb(0.85, 0.87, 0.9);

export type PdfContext = { page: PDFPage; font: PDFFont; bold: PDFFont };

type TextOptions = { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> };

/**
 * pdf-lib's standard fonts are WinAnsi-encoded, which covers French accents
 * but not typographic extras. Any character outside the encoding throws at
 * draw time, so text is normalised before it ever reaches the page.
 *
 * The space variants matter more than they look: `toLocaleString("fr-FR")`
 * groups thousands with U+202F (narrow no-break space), so every amount of
 * 1 000 or more carried a character WinAnsi cannot encode — the renderer
 * threw on exactly the invoices and orders that matter most. Escapes are
 * written as code points rather than literal characters so the rule can't
 * be silently broken by an editor normalising the source file.
 */
export function toWinAnsi(value: string): string {
  return (
    value
      // Space variants → plain space: U+00A0, U+202F, U+2007, U+2009, U+200A, U+2060.
      .replace(/[\u00A0\u202F\u2007\u2009\u200A\u2060]/g, " ")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2026/g, "...")
      .replace(/[\u2013\u2014\u2212]/g, "-")
      // Last-resort guard: anything still outside WinAnsi's reach is
      // dropped rather than allowed to throw mid-render.
      .replace(/[^\u0000-\u00FF\u20AC\u0152\u0153\u017D\u017E\u0160\u0161\u0178\u0192]/g, "")
  );
}

export function text(
  ctx: PdfContext,
  value: string,
  x: number,
  y: number,
  options: TextOptions = {},
) {
  const { size = 10, bold = false, color = INK } = options;
  ctx.page.drawText(toWinAnsi(value), { x, y, size, font: bold ? ctx.bold : ctx.font, color });
}

/** Right-aligns within a column, which is what makes money columns readable. */
export function textRight(
  ctx: PdfContext,
  value: string,
  right: number,
  y: number,
  options: TextOptions = {},
) {
  const { size = 10, bold = false } = options;
  const normalised = toWinAnsi(value);
  const width = (bold ? ctx.bold : ctx.font).widthOfTextAtSize(normalised, size);
  text(ctx, value, right - width, y, options);
}

/** Truncates with an ellipsis so a long product name can't run into the next column. */
export function fit(ctx: PdfContext, value: string, maxWidth: number, size: number): string {
  const normalised = toWinAnsi(value);
  if (ctx.font.widthOfTextAtSize(normalised, size) <= maxWidth) return normalised;
  let cut = normalised;
  while (cut.length > 1 && ctx.font.widthOfTextAtSize(`${cut}...`, size) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}...`;
}

/**
 * Trace une matrice de QR code en rectangles pleins.
 *
 * Vectoriel, donc net à toute échelle et à l'impression — un PNG
 * intermédiaire imposerait de choisir une résolution, et un QR pixellisé
 * se lit mal une fois photocopié.
 *
 * `(x, y)` est le coin **inférieur gauche**, comme partout ailleurs dans
 * pdf-lib. Les modules sont dessinés depuis le haut : la matrice est
 * indexée en lignes descendantes, l'axe du PDF monte. Inverser les deux
 * retournerait le symbole — et un QR retourné se lit encore, ce qui rend
 * l'erreur d'autant plus facile à laisser passer.
 */
export function qrMatrix(
  ctx: PdfContext,
  matrice: boolean[][],
  x: number,
  y: number,
  taille: number,
  options: {
    /** Logo posé au centre, avec sa réserve blanche. */
    logo?: PDFImage;
    /** Part du côté occupée par le logo. Voir PART_LOGO. */
    partLogo?: number;
  } = {},
) {
  const modules = matrice.length;
  if (modules === 0) return;
  const cote = taille / modules;

  /*
   * Les modules que le logo recouvrira ne sont pas dessinés du tout.
   * Les tracer puis les masquer donnerait le même résultat à l'œil, mais
   * un lecteur de PDF qui ignore l'ordre de superposition — ou une
   * conversion en niveaux de gris — les ferait réapparaître sous le logo.
   */
  const part = options.logo ? (options.partLogo ?? 0.22) : 0;
  const centre = (modules - 1) / 2;
  // Rayon en modules, avec un demi-module de marge : la réserve est un
  // disque et non un carré, pour épouser la pastille ronde du logo. Un
  // carré laisserait quatre coins de blanc autour d'elle.
  const rayon = (modules * part) / 2 + 0.5;
  const dansLaReserve = (ligne: number, colonne: number) =>
    options.logo !== undefined &&
    Math.hypot(ligne - centre, colonne - centre) <= rayon;

  for (let ligne = 0; ligne < modules; ligne += 1) {
    for (let colonne = 0; colonne < modules; colonne += 1) {
      if (!matrice[ligne]![colonne]) continue;
      if (dansLaReserve(ligne, colonne)) continue;
      ctx.page.drawRectangle({
        x: x + colonne * cote,
        y: y + taille - (ligne + 1) * cote,
        // Un poil plus grand que le pas : sans ce recouvrement, les
        // arrondis du moteur de rendu laissent des cheveux blancs entre
        // modules voisins, que les lecteurs prennent pour des séparations.
        width: cote + 0.2,
        height: cote + 0.2,
        color: INK,
      });
    }
  }

  if (!options.logo) return;

  // Pastille blanche, puis l'icône dedans. Le disque blanc sépare le logo
  // de la trame : sans lui, l'icône touche des modules noirs et le lecteur
  // ne distingue plus sa frontière du symbole.
  const cx = x + taille / 2;
  const cy = y + taille / 2;
  ctx.page.drawCircle({ x: cx, y: cy, size: rayon * cote, color: rgb(1, 1, 1) });

  const coteImage = taille * part;
  ctx.page.drawImage(options.logo, {
    x: cx - coteImage / 2,
    y: cy - coteImage / 2,
    width: coteImage,
    height: coteImage,
  });
}

/**
 * Le logo, quand il y en a un et qu'il est lisible.
 *
 * `null` à la moindre difficulté — URL injoignable, format WebP que
 * pdf-lib ne sait pas embarquer, octets corrompus. Un bordereau sans logo
 * reste un bordereau valable ; un bordereau qui n'a pas pu être généré
 * n'est rien du tout, et c'est de l'argent qu'on ne réclame pas.
 */
/**
 * L'icône Akribis, prête à poser au centre d'un QR code.
 *
 * `null` plutôt qu'une exception si l'embarquement échoue : un QR sans
 * logo reste parfaitement lisible, une facture qui n'a pas pu être
 * générée n'est rien du tout.
 */
export async function chargerIconeAkribis(doc: PDFDocument): Promise<PDFImage | null> {
  try {
    return await doc.embedPng(ICONE_AKRIBIS_PNG_BASE64);
  } catch {
    return null;
  }
}

export async function chargerLogo(doc: PDFDocument, url: string | null): Promise<PDFImage | null> {
  if (!url) return null;
  try {
    const reponse = await fetch(url);
    if (!reponse.ok) return null;
    const octets = new Uint8Array(await reponse.arrayBuffer());
    // Signature plutôt qu'extension : l'URL porte un paramètre de cache
    // (`?v=...`) et l'extension y ment aussi souvent qu'elle dit vrai.
    //
    // Aucun test ne distingue cette vérification de son absence, et c'est
    // normal : le `catch` ci-dessous rattrape de toute façon un format
    // refusé, donc le document sort identique dans les deux cas. Elle est
    // là pour la lisibilité — ne pas piloter le flux normal par une
    // exception — pas pour changer le résultat.
    const estPng = octets[0] === 0x89 && octets[1] === 0x50;
    const estJpg = octets[0] === 0xff && octets[1] === 0xd8;
    if (estPng) return await doc.embedPng(octets);
    if (estJpg) return await doc.embedJpg(octets);
    return null;
  } catch {
    return null;
  }
}

/**
 * Le pied de page, identique sur tous les documents de l'application.
 *
 * Trois informations, et chacune répond à une question qu'on se pose une
 * feuille à la main : d'où vient ce document, de quand date ce tirage, et
 * en manque-t-il une page. La dernière est la plus utile des trois — un
 * bordereau de six pages dont il n'en reste que quatre ne se signale
 * autrement par rien.
 *
 * Le total exige de compter les pages avant d'écrire : chaque rendu
 * collecte ses contextes et appelle ceci en dernier, une fois le nombre
 * connu.
 */
export const PIED_MARQUE = "Propulsé par Akribis Pharma - www.pharma.akribis.ma";

export function piedDePage(ctx: PdfContext, numeroPage: number, total: number) {
  const y = MARGIN - 18;
  text(ctx, PIED_MARQUE, MARGIN, y, { size: 8, color: MUTED });

  const edition = new Date().toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  textRight(ctx, `Édité le ${edition} · Page ${numeroPage} / ${total}`, A4.width - MARGIN, y, {
    size: 8,
    color: MUTED,
  });
}

/** Full-width hairline across the printable area. */
export function rule(ctx: PdfContext, y: number) {
  ctx.page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4.width - MARGIN, y },
    thickness: 0.7,
    color: RULE,
  });
}
