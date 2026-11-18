import { getDelivery } from "@/lib/server/orders";
import { getReceiptBranding } from "@/lib/server/pharmacy";
import { renderDeliveryNotePdf } from "@/lib/orders/delivery-note-pdf";
import { formatDeliveryNumber } from "@/lib/orders/numbering";
import { ENTITES } from "@/lib/audit/event-log";
import { journaliserTelechargement } from "@/lib/audit/export-document";

/**
 * Streams one delivery note as a downloadable PDF. getDelivery() is
 * tenant-scoped, so an id from another pharmacy 404s rather than leaking
 * a document.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ deliveryId: string }> },
) {
  const { deliveryId } = await params;
  const [delivery, branding] = await Promise.all([
    getDelivery(deliveryId),
    getReceiptBranding(),
  ]);
  if (!delivery) {
    return new Response("Bon de livraison introuvable", { status: 404 });
  }

  await journaliserTelechargement({
    entite: ENTITES.bonLivraison,
    entiteId: delivery.id,
    nom: formatDeliveryNumber(delivery.numero),
  });

  const pdf = await renderDeliveryNotePdf(delivery, branding);

  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${formatDeliveryNumber(delivery.numero)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
