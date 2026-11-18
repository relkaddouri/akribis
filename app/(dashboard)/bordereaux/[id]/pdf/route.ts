import { getBordereau } from "@/lib/server/bordereaux";
import { getReceiptBranding } from "@/lib/server/pharmacy";
import { renderBordereauPdf } from "@/lib/bordereaux/pdf";
import { ENTITES } from "@/lib/audit/event-log";
import { journaliserTelechargement } from "@/lib/audit/export-document";

/**
 * Le bordereau en PDF, prêt à imprimer et à envoyer.
 *
 * `getBordereau()` est borné à l'officine de l'appelant : un identifiant
 * appartenant à une autre pharmacie répond 404 plutôt que de laisser
 * fuir un document.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [bordereau, branding] = await Promise.all([getBordereau(id), getReceiptBranding()]);
  if (!bordereau) {
    return new Response("Bordereau introuvable", { status: 404 });
  }

  await journaliserTelechargement({
    entite: ENTITES.bordereau,
    entiteId: bordereau.id,
    nom: bordereau.numero,
  });

  const pdf = await renderBordereauPdf(bordereau, branding);

  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${bordereau.numero}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
