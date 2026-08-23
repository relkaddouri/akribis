import { getJournalZ } from "@/lib/server/caisse";
import { getReceiptBranding } from "@/lib/server/pharmacy";
import { renderJournalZPdf } from "@/lib/caisse/journal-z-pdf";
import { ENTITES } from "@/lib/audit/event-log";
import { journaliserTelechargement } from "@/lib/audit/export-document";

/**
 * Le Journal Z en PDF imprimable.
 *
 * `getJournalZ()` est cantonné à l'officine de l'appelant : un
 * identifiant appartenant à une autre pharmacie rend 404 plutôt que de
 * laisser fuir sa journée comptable.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [z, branding] = await Promise.all([getJournalZ(id), getReceiptBranding()]);

  if (!z) {
    return new Response("Journal Z introuvable", { status: 404 });
  }
  if (!z.session.numeroZ) {
    // Une session ouverte n'a pas de Z : ses totaux bougent encore, et un
    // document imprimé le laisserait croire arrêté.
    return new Response("Cette session n'est pas encore clôturée", { status: 409 });
  }

  await journaliserTelechargement({
    entite: ENTITES.caisseSession,
    entiteId: z.session.id,
    nom: z.session.numeroZ,
  });

  const pdf = await renderJournalZPdf(z, branding);

  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${z.session.numeroZ}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
