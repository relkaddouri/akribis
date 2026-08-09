import { notFound } from "next/navigation";
import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { getInvoice } from "@/lib/server/invoices";
import { formatMad, summariseTvaByRate } from "@/lib/invoices/totals";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function FactureDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoice = await getInvoice(id);
  if (!invoice) notFound();

  const recap = summariseTvaByRate(
    invoice.lines.map((line) => ({
      productId: null,
      designation: line.designation,
      quantity: line.quantity,
      unitPriceHt: line.unitPriceHt,
      tvaRate: line.tvaRate,
      totalHt: line.totalHt,
      totalTva: line.totalTva,
      totalTtc: line.totalTtc,
    })),
  );

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title={invoice.number}
        icon={<FileText />}
        actions={
          <div className="flex gap-sp-sm">
            <Button variant="outline" asChild>
              <Link href="/factures">Retour</Link>
            </Button>
            <Button asChild>
              {/* Plain anchor, not <Link>: this is a file download, not a
                  client-side navigation. */}
              <a href={`/factures/${invoice.id}/pdf`}>
                <Download /> Télécharger le PDF
              </a>
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="space-y-sp-lg">
          <div className="flex flex-wrap items-start justify-between gap-sp-lg">
            <div className="space-y-sp-xs text-sm">
              <p className="font-heading text-base font-bold text-foreground">
                {invoice.pharmacyName}
              </p>
              {invoice.pharmacyAddress && (
                <p className="text-muted-foreground">{invoice.pharmacyAddress}</p>
              )}
              {invoice.pharmacyPhone && (
                <p className="text-muted-foreground">{invoice.pharmacyPhone}</p>
              )}
              {invoice.pharmacyIce && (
                <p className="text-muted-foreground">ICE : {invoice.pharmacyIce}</p>
              )}
            </div>
            <div className="space-y-sp-xs text-right text-sm">
              <p className="font-heading text-base font-bold text-foreground">{invoice.number}</p>
              <p className="text-muted-foreground">
                {invoice.issuedAt.toLocaleDateString("fr-FR")}
              </p>
              {invoice.status === "cancelled" && <Badge variant="destructive">Annulée</Badge>}
            </div>
          </div>

          <div className="text-sm">
            <p className="text-muted-foreground text-xs">Facturé à</p>
            <p className="font-medium text-foreground">
              {invoice.clientName ?? "Client de passage"}
            </p>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Désignation</TableHead>
                <TableHead className="text-right">Qté</TableHead>
                <TableHead className="text-right">P.U. HT</TableHead>
                <TableHead className="text-right">TVA</TableHead>
                <TableHead className="text-right">Total HT</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>{line.designation}</TableCell>
                  <TableCell className="text-right">{line.quantity}</TableCell>
                  <TableCell className="text-right">{line.unitPriceHt.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{line.tvaRate.toFixed(0)} %</TableCell>
                  <TableCell className="text-right">{line.totalHt.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="ml-auto w-full max-w-xs space-y-sp-xs text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total HT</span>
              <span>{formatMad(invoice.totalHt)}</span>
            </div>
            {recap.map((entry) => (
              <div key={entry.rate} className="flex justify-between">
                <span className="text-muted-foreground">TVA {entry.rate.toFixed(0)} %</span>
                <span>{formatMad(entry.tva)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t pt-sp-xs font-heading text-base font-bold">
              <span>Total TTC</span>
              <span>{formatMad(invoice.totalTtc)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
