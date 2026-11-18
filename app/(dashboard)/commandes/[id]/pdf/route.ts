import { getOrder } from "@/lib/server/orders";
import { getReceiptBranding } from "@/lib/server/pharmacy";
import { renderPurchaseOrderPdf } from "@/lib/orders/purchase-order-pdf";
import { formatOrderNumber } from "@/lib/orders/numbering";
import { ENTITES } from "@/lib/audit/event-log";
import { journaliserTelechargement } from "@/lib/audit/export-document";

/**
 * Streams the purchase order as a downloadable PDF. getOrder() is
 * tenant-scoped, so an id from another pharmacy 404s rather than leaking
 * a document.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [order, branding] = await Promise.all([getOrder(id), getReceiptBranding()]);
  if (!order) {
    return new Response("Commande introuvable", { status: 404 });
  }

  await journaliserTelechargement({
    entite: ENTITES.bonCommande,
    entiteId: order.id,
    nom: formatOrderNumber(order.numero),
  });

  const pdf = await renderPurchaseOrderPdf(
    {
      numero: order.numero,
      createdAt: order.createdAt,
      supplierName: order.supplierName,
      supplierPhone: order.supplierPhone,
      supplierEmail: order.supplierEmail,
      lines: order.items.map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
      totalAmount: order.totalAmount,
    },
    branding,
  );

  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${formatOrderNumber(order.numero)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
