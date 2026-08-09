import { getInvoice } from "@/lib/server/invoices";
import { renderInvoicePdf } from "@/lib/invoices/pdf";

/**
 * Streams the invoice as a real PDF download. getInvoice() is
 * tenant-scoped, so an id belonging to another pharmacy 404s here rather
 * than leaking a document.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const invoice = await getInvoice(id);
  if (!invoice) {
    return new Response("Facture introuvable", { status: 404 });
  }

  const pdf = await renderInvoicePdf(invoice);

  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      // `attachment` is what makes the browser download rather than
      // preview it, which is what "PDF téléchargeable" asks for.
      "Content-Disposition": `attachment; filename="${invoice.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
