"use client";

import { useMemo, useState, useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import {
  exporterJournalCsv,
  listEventLogPharmacie,
  type EventLogRecord,
  type FiltresJournal,
} from "@/lib/server/audit";
import { libelleAction } from "@/lib/audit/event-log";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ActionBadge,
  horodatage,
  JournalDetail,
} from "@/components/features/audit/journal-parts";

/**
 * Le journal d'audit de l'officine, dans les Paramètres.
 *
 * Ici et non dans la barre latérale : ce n'est pas un module de travail
 * quotidien mais un registre qu'on vient consulter en cas de question —
 * qui a ouvert cette fiche, qui a changé ce plafond. Une entrée
 * permanente dans la navigation lui donnerait le poids d'une Caisse ou
 * d'un Stock.
 *
 * Les filtres passent par le serveur, jamais par le tableau. La lecture
 * est plafonnée à 500 entrées : filtrer après coup appliquerait le
 * plafond **avant** le filtre, et une recherche sur mars ne trouverait
 * rien parce que les 500 dernières entrées datent d'avril.
 */

const TOUS = "__tous__";

function nomFichier(): string {
  const maintenant = new Date();
  const jour = String(maintenant.getDate()).padStart(2, "0");
  const mois = String(maintenant.getMonth() + 1).padStart(2, "0");
  return `journal-audit-${maintenant.getFullYear()}-${mois}-${jour}.csv`;
}

export function JournalAuditSection({
  entreesInitiales,
  acteurs,
  actions,
}: {
  entreesInitiales: EventLogRecord[];
  acteurs: string[];
  actions: string[];
}) {
  const [entrees, setEntrees] = useState(entreesInitiales);
  const [acteur, setActeur] = useState(TOUS);
  const [action, setAction] = useState(TOUS);
  const [debut, setDebut] = useState("");
  const [fin, setFin] = useState("");
  const [ouverte, setOuverte] = useState<EventLogRecord | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, startChargement] = useTransition();
  const [envoi, startEnvoi] = useTransition();

  const filtres: FiltresJournal = useMemo(
    () => ({
      acteur: acteur === TOUS ? undefined : acteur,
      typeAction: action === TOUS ? undefined : action,
      debut: debut || undefined,
      fin: fin || undefined,
    }),
    [acteur, action, debut, fin],
  );

  function appliquer(prochain: Partial<{ acteur: string; action: string; debut: string; fin: string }>) {
    const suivants: FiltresJournal = {
      acteur: (prochain.acteur ?? acteur) === TOUS ? undefined : (prochain.acteur ?? acteur),
      typeAction: (prochain.action ?? action) === TOUS ? undefined : (prochain.action ?? action),
      debut: (prochain.debut ?? debut) || undefined,
      fin: (prochain.fin ?? fin) || undefined,
    };
    if (prochain.acteur !== undefined) setActeur(prochain.acteur);
    if (prochain.action !== undefined) setAction(prochain.action);
    if (prochain.debut !== undefined) setDebut(prochain.debut);
    if (prochain.fin !== undefined) setFin(prochain.fin);

    setErreur(null);
    startChargement(async () => {
      try {
        setEntrees(await listEventLogPharmacie(suivants));
      } catch (e) {
        setErreur((e as Error).message);
      }
    });
  }

  function exporter() {
    setErreur(null);
    startEnvoi(async () => {
      try {
        const csv = await exporterJournalCsv(filtres);
        // Blob plutôt qu'une route de téléchargement : le CSV est déjà en
        // mémoire, et une route imposerait de repasser les filtres en
        // paramètres d'URL — donc d'y écrire des e-mails d'utilisateurs.
        const lien = document.createElement("a");
        lien.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        lien.download = nomFichier();
        lien.click();
        URL.revokeObjectURL(lien.href);
        // L'export vient d'écrire sa propre entrée : la relecture la fait
        // apparaître, ce qui est exactement ce qu'on veut montrer.
        setEntrees(await listEventLogPharmacie(filtres));
      } catch (e) {
        setErreur((e as Error).message);
      }
    });
  }

  const columns = useMemo<DataTableColumn<EventLogRecord>[]>(
    () => [
      {
        id: "date",
        header: "Quand",
        sortValue: (e) => new Date(e.createdAt).getTime(),
        cell: (e) => <span className="tabular-nums text-sm">{horodatage(e.createdAt)}</span>,
      },
      {
        id: "action",
        header: "Action",
        sortValue: (e) => libelleAction(e.typeAction).toLowerCase(),
        cell: (e) => <ActionBadge typeAction={e.typeAction} />,
      },
      {
        id: "cible",
        header: "Enregistrement",
        sortValue: (e) => (e.cible ?? e.entiteId).toLowerCase(),
        cell: (e) => (
          <div className="min-w-0">
            <p className="truncate text-sm text-foreground">{e.cible ?? e.entite}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">{e.entiteId}</p>
          </div>
        ),
      },
      {
        id: "acteur",
        header: "Utilisateur",
        sortValue: (e) => e.acteurEmail.toLowerCase(),
        cell: (e) => (
          <div className="min-w-0">
            <p className="truncate text-sm">{e.acteurEmail}</p>
            <Badge variant="secondary">{e.acteurRole}</Badge>
          </div>
        ),
      },
      {
        id: "detail",
        header: "",
        cell: (e) => (
          <Button variant="ghost" size="sm" onClick={() => setOuverte(e)}>
            Détail
          </Button>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-sp-md">
      <div className="flex flex-wrap items-end gap-sp-md">
        <div className="min-w-48 flex-1 space-y-sp-xs">
          <Label htmlFor="journal-acteur">Utilisateur</Label>
          <Select value={acteur} onValueChange={(v) => appliquer({ acteur: v })}>
            <SelectTrigger id="journal-acteur" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TOUS}>Tous</SelectItem>
              {acteurs.map((valeur) => (
                <SelectItem key={valeur} value={valeur}>
                  {valeur}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-48 flex-1 space-y-sp-xs">
          <Label htmlFor="journal-action">Type d&apos;action</Label>
          <Select value={action} onValueChange={(v) => appliquer({ action: v })}>
            <SelectTrigger id="journal-action" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TOUS}>Toutes</SelectItem>
              {actions.map((valeur) => (
                <SelectItem key={valeur} value={valeur}>
                  {libelleAction(valeur)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-sp-xs">
          <Label htmlFor="journal-debut">Du</Label>
          <Input
            id="journal-debut"
            type="date"
            value={debut}
            onChange={(e) => appliquer({ debut: e.target.value })}
          />
        </div>
        <div className="space-y-sp-xs">
          <Label htmlFor="journal-fin">Au</Label>
          <Input
            id="journal-fin"
            type="date"
            value={fin}
            onChange={(e) => appliquer({ fin: e.target.value })}
          />
        </div>

        <Button variant="outline" disabled={envoi || entrees.length === 0} onClick={exporter}>
          {envoi ? <Loader2 className="animate-spin" /> : <Download />}
          Exporter en CSV
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        L&apos;export est lui-même journalisé : sortir des données personnelles de
        l&apos;application laisse une trace, au même titre que les consulter.
      </p>

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur}</AlertDescription>
        </Alert>
      )}

      <DataTable
        data={entrees}
        columns={columns}
        getRowId={(e) => e.id}
        isLoading={chargement}
        // Rien à sélectionner : le journal ne se supprime pas et ne se
        // traite pas en lot. Des cases à cocher promettraient une action
        // que la base refuse.
        selectable={false}
        searchFields={(e) => [e.cible ?? "", e.acteurEmail, libelleAction(e.typeAction), e.entiteId]}
        searchPlaceholder="Rechercher par enregistrement, utilisateur ou action..."
        emptyTitle="Aucune action enregistrée"
        emptyDescription="Le journal se remplit dès qu'une fiche client est créée, consultée ou modifiée."
      />

      <JournalDetail entree={ouverte} onClose={() => setOuverte(null)} />
    </div>
  );
}
