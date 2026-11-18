import { notFound } from "next/navigation";
import {
  Banknote,
  CreditCard,
  Download,
  Landmark,
  LockOpen,
  Percent,
  Receipt,
  ShieldCheck,
  TrendingUp,
  UserRound,
  WifiOff,
} from "lucide-react";
import { getJournalZ } from "@/lib/server/caisse";
import { formatMad } from "@/lib/invoices/totals";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";

/**
 * Le Journal Z à l'écran.
 *
 * Une pièce comptable se lit dans un ordre : d'abord si le compte y est,
 * ensuite ce qui compose la journée. L'écart occupe donc la place forte —
 * un bandeau teinté, un chiffre en grand — et le reste s'organise en
 * cartes derrière lui. En quatre tableaux de même poids, il fallait
 * chercher des yeux le seul nombre qui décide de la suite.
 */

function horodatage(date: Date | null): string {
  return date ? new Date(date).toLocaleString("fr-FR") : "—";
}

/** Une ligne libellé / valeur, l'unité de base des cartes. */
function Ligne({
  libelle,
  valeur,
  fort = false,
}: {
  libelle: string;
  valeur: React.ReactNode;
  fort?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-sp-md border-b border-border/50 py-sp-sm last:border-0">
      <span className={cn("text-sm", fort ? "font-medium text-foreground" : "text-muted-foreground")}>
        {libelle}
      </span>
      <span
        className={cn(
          "shrink-0 tabular-nums",
          fort ? "font-heading text-base font-bold text-foreground" : "text-sm text-foreground",
        )}
      >
        {valeur}
      </span>
    </div>
  );
}

function Section({
  titre,
  icone,
  className,
  children,
}: {
  titre: string;
  icone: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-sp-sm text-sm">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
            aria-hidden
          >
            {icone}
          </span>
          {titre}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}

export default async function JournalZPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const z = await getJournalZ(id);
  if (!z) notFound();

  const { session } = z;
  const ecart = session.ecartCaisse;
  const juste = ecart === 0;
  const manque = ecart !== null && ecart < 0;

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title={session.numeroZ ?? "Session en cours"}
        subtitle={z.pharmacyName}
        icon={<Landmark />}
        backHref="/caisse"
        backLabel="Journal Z"
        actions={
          session.numeroZ ? (
            <Button asChild>
              {/* Ancre nue, pas <Link> : c'est un téléchargement, pas une
                  navigation côté client. */}
              <a href={`/caisse/${session.id}/pdf`}>
                <Download /> Imprimer le Z
              </a>
            </Button>
          ) : undefined
        }
      />

      {/*
        L'écart en bandeau, avant tout le reste : c'est la question à
        laquelle un Z répond. Teinté selon la réponse — vert si le compte y
        est, rouge s'il manque de l'argent, ambre s'il y en a trop, parce
        qu'un excédent est une anomalie à expliquer et non une bonne
        nouvelle.
      */}
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-sp-lg rounded-xl px-sp-lg py-sp-md",
          ecart === null && "bg-muted/50",
          juste && "bg-emerald-50 dark:bg-emerald-950/40",
          manque && "bg-red-50 dark:bg-red-950/40",
          ecart !== null && ecart > 0 && "bg-amber-50 dark:bg-amber-950/40",
        )}
      >
        <div className="flex items-center gap-sp-md">
          <span
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-xl",
              juste && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
              manque && "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
              (ecart === null || ecart > 0) && "bg-background text-muted-foreground",
            )}
            aria-hidden
          >
            <Banknote className="size-6" strokeWidth={1.75} />
          </span>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Écart de caisse
            </p>
            <p
              className={cn(
                "font-heading text-3xl font-extrabold tabular-nums",
                juste && "text-emerald-700 dark:text-emerald-300",
                manque && "text-red-700 dark:text-red-300",
                ecart !== null && ecart > 0 && "text-amber-700 dark:text-amber-300",
                ecart === null && "text-muted-foreground",
              )}
            >
              {ecart === null
                ? "—"
                : juste
                  ? "Le compte y est"
                  : `${ecart > 0 ? "+" : "−"}${formatMad(Math.abs(ecart))}`}
            </p>
          </div>
        </div>

        <dl className="flex flex-wrap gap-sp-lg text-sm">
          {[
            ["Fond initial", session.fondCaisseInitial],
            ["Théoriques", session.especesTheoriques],
            ["Comptées", session.especesReelles],
          ].map(([libelle, valeur]) => (
            <div key={libelle as string}>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{libelle}</dt>
              <dd className="font-heading font-bold tabular-nums text-foreground">
                {valeur === null ? "—" : formatMad(valeur as number)}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Avant les totaux, parce qu'il change leur lecture. */}
      {z.rattrapagesOffline > 0 && (
        <div className="flex items-start gap-sp-sm rounded-xl border border-amber-500/30 bg-amber-50 p-sp-md text-sm dark:bg-amber-950/30">
          <WifiOff className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-200">
              {z.rattrapagesOffline} vente{z.rattrapagesOffline > 1 ? "s" : ""} hors ligne
              rattachée{z.rattrapagesOffline > 1 ? "s" : ""} à cette journée
            </p>
            <p className="text-amber-800 dark:text-amber-300">
              Elles ont eu lieu un jour dont la caisse était déjà clôturée. Une session fermée
              ne se rouvre jamais : elles figurent donc dans ce Z, pas dans celui de leur date.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-sp-md lg:grid-cols-3">
        <Section titre="Chiffre d'affaires" icone={<TrendingUp className="size-4" />}>
          <Ligne
            libelle="Ventes"
            valeur={
              <span className="inline-flex items-center gap-1.5">
                <Receipt className="size-3.5 text-muted-foreground" aria-hidden />
                {z.totaux.nombreVentes}
              </span>
            }
          />
          <Ligne libelle="CA brut TTC" valeur={formatMad(z.totaux.caBrut)} />
          <Ligne libelle="Retours et annulations" valeur={`− ${formatMad(z.totaux.retours)}`} />
          <Ligne libelle="CA net TTC" valeur={formatMad(z.totaux.caNet)} fort />
        </Section>

        <Section titre="Par mode de règlement" icone={<CreditCard className="size-4" />}>
          <Ligne libelle="Espèces" valeur={formatMad(z.paiements.CASH)} />
          <Ligne libelle="Carte" valeur={formatMad(z.paiements.CARD)} />
          <Ligne libelle="Crédit client" valeur={formatMad(z.paiements.CREDIT)} />
          {/* À part, jamais additionnée : c'est une créance sur
              l'organisme, pas de l'argent encaissé. */}
          <Ligne
            libelle="Part organisme"
            valeur={
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-muted-foreground" aria-hidden />
                {formatMad(z.paiements.tiersPayant)}
              </span>
            }
          />
        </Section>

        <Section titre="TVA collectée" icone={<Percent className="size-4" />}>
          {z.tva.length === 0 ? (
            <p className="py-sp-md text-sm text-muted-foreground">
              Aucune vente sur cette session.
            </p>
          ) : (
            z.tva.map((ligne) => (
              <Ligne
                key={ligne.taux}
                libelle={`TVA ${ligne.taux} % · base ${formatMad(ligne.baseHt)}`}
                valeur={formatMad(ligne.tva)}
              />
            ))
          )}
        </Section>
      </div>

      <Section titre="Identification" icone={<LockOpen className="size-4" />}>
        <div className="grid gap-x-sp-lg sm:grid-cols-2">
          <Ligne libelle="Pharmacie" valeur={z.pharmacyName} />
          <Ligne
            libelle="Ouverture"
            valeur={
              <span className="inline-flex items-center gap-1.5">
                <UserRound className="size-3.5 text-muted-foreground" aria-hidden />
                {session.ouvreurNom} · {horodatage(session.dateOuverture)}
              </span>
            }
          />
          <Ligne libelle="Identifiant fiscal" valeur={z.identifiantFiscal ?? "—"} />
          <Ligne
            libelle="Fermeture"
            valeur={
              <span className="inline-flex items-center gap-1.5">
                <UserRound className="size-3.5 text-muted-foreground" aria-hidden />
                {session.fermeurNom ?? "—"} · {horodatage(session.dateFermeture)}
                {/* La mention du PIN reste visible : le titulaire doit
                    pouvoir distinguer qui a réellement clôturé. */}
                {session.fermetureParPin && (
                  <Badge variant="secondary" className="ml-1">
                    code PIN
                  </Badge>
                )}
              </span>
            }
          />
          <Ligne libelle="ICE" valeur={z.ice ?? "—"} />
        </div>
      </Section>
    </div>
  );
}
