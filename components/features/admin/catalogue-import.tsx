"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { analyseCatalogueImport, runCatalogueImport } from "@/lib/server/catalogue";
import type { ImportPreview, ImportReport } from "@/lib/server/catalogue";
import { IMPORT_FIELDS, type ColumnMapping } from "@/lib/catalogue/import-mapping";
import { PRODUIT_CATEGORIES, type ProduitCategorieValue } from "@/lib/validations/catalogue";
import { ADMIN_CATALOGUE_PATH } from "@/lib/auth/access-control";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const NO_COLUMN = "__none__";
const NO_CATEGORY = "__none__";

function Stat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: "good" | "warn" | "bad";
}) {
  const colour =
    tone === "good"
      ? "text-primary"
      : tone === "warn"
        ? "text-amber-600"
        : tone === "bad"
          ? "text-destructive"
          : "text-foreground";

  return (
    <div className="rounded-xl bg-card px-sp-md py-sp-sm shadow-card">
      <p className={`font-heading text-2xl font-bold tabular-nums ${colour}`}>
        {value.toLocaleString("fr-MA")}
      </p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export function CatalogueImport() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  // The File itself is kept client-side and uploaded a second time on
  // confirm — see analyseCatalogueImport for why nothing is held server-side.
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [categorie, setCategorie] = useState<ProduitCategorieValue | "">("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  function analyse(nextFile: File, nextMapping?: ColumnMapping, nextCategorie?: string) {
    setError(null);
    setReport(null);

    const formData = new FormData();
    formData.set("file", nextFile);
    if (nextMapping) formData.set("mapping", JSON.stringify(nextMapping));
    if (nextCategorie) formData.set("categorie", nextCategorie);

    startTransition(async () => {
      const result = await analyseCatalogueImport(formData);
      if (!result.ok) {
        setError(result.error);
        setPreview(null);
        return;
      }
      setPreview(result);
      setMapping(result.mapping);
    });
  }

  function handleFile(nextFile: File | null) {
    setFile(nextFile);
    setPreview(null);
    setReport(null);
    if (nextFile) analyse(nextFile);
  }

  /** Re-runs the whole analysis: duplicate counts depend on the mapping. */
  function updateMapping(key: string, value: string) {
    if (!file) return;
    const next = { ...mapping, [key]: value === NO_COLUMN ? null : Number(value) };
    setMapping(next);
    analyse(file, next, categorie || undefined);
  }

  function updateCategorie(value: string) {
    const next = value === NO_CATEGORY ? "" : (value as ProduitCategorieValue);
    setCategorie(next);
    if (file) analyse(file, mapping, next || undefined);
  }

  function confirmImport() {
    if (!file) return;
    setError(null);

    const formData = new FormData();
    formData.set("file", file);
    formData.set("mapping", JSON.stringify(mapping));
    if (categorie) formData.set("categorie", categorie);

    startTransition(async () => {
      const result = await runCatalogueImport(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReport(result);
      setPreview(null);
      router.refresh();
    });
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setReport(null);
    setError(null);
    setMapping({});
    if (inputRef.current) inputRef.current.value = "";
  }

  // ------------------------------------------------------------ Rapport
  if (report) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-sp-lg">
        <div className="rounded-xl bg-card p-6 shadow-card">
          <div className="flex items-start gap-sp-md">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
              <CheckCircle2 className="size-5" />
            </span>
            <div>
              <h2 className="font-heading text-lg font-bold">Import terminé</h2>
              <p className="text-sm text-muted-foreground">
                Les doublons ont été laissés intacts : aucune fiche existante n&apos;a été modifiée.
              </p>
            </div>
          </div>

          <div className="mt-sp-lg grid gap-sp-md sm:grid-cols-3">
            <Stat value={report.crees} label="fiches créées" tone="good" />
            <Stat value={report.ignoresDoublons} label="ignorées (doublons)" tone="warn" />
            <Stat value={report.enErreur} label="en erreur" tone={report.enErreur > 0 ? "bad" : undefined} />
          </div>
        </div>

        <RejectionList rejets={report.rejets} />

        <div className="flex justify-between">
          <Button variant="outline" onClick={reset}>
            Importer un autre fichier
          </Button>
          <Button asChild>
            <Link href={ADMIN_CATALOGUE_PATH}>Voir le catalogue</Link>
          </Button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------- Saisie
  return (
    <div className="mx-auto w-full max-w-4xl space-y-sp-lg">
      <div className="rounded-xl bg-card p-6 shadow-card">
        <Label htmlFor="fichier">Fichier à importer</Label>
        <p className="mt-1 text-sm text-muted-foreground">
          Classeur Excel (.xlsx) ou CSV. Le format du référentiel CNOPS est reconnu
          automatiquement — les colonnes restent modifiables ci-dessous.
        </p>
        <div className="mt-sp-md flex flex-wrap items-center gap-sp-md">
          <input
            ref={inputRef}
            id="fichier"
            type="file"
            accept=".xlsx,.csv,.txt,.tsv"
            onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
            className="block w-full max-w-sm text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary hover:file:bg-accent/80"
          />
          {file && (
            <span className="flex items-center gap-sp-xs text-sm text-muted-foreground">
              <FileSpreadsheet className="size-4" />
              {file.name}
            </span>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {pending && !preview && (
        <p className="text-sm text-muted-foreground">Lecture du fichier...</p>
      )}

      {preview && (
        <>
          <div className="grid gap-sp-md sm:grid-cols-4">
            <Stat value={preview.lues} label="lignes lues" />
            <Stat value={preview.aCreer} label="à créer" tone="good" />
            <Stat value={preview.doublons.length} label="doublons" tone="warn" />
            <Stat
              value={preview.rejets.length}
              label="en erreur"
              tone={preview.rejets.length > 0 ? "bad" : undefined}
            />
          </div>

          <div className="rounded-xl bg-card p-6 shadow-card">
            <h2 className="font-heading text-lg font-bold">Correspondance des colonnes</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Vérifiez avant d&apos;importer : une colonne mal associée mettrait de fausses données
              dans le catalogue de toutes les pharmacies.
            </p>

            <div className="mt-sp-lg grid gap-4 sm:grid-cols-2">
              {IMPORT_FIELDS.map((field) => {
                const value = mapping[field.key];
                const missing = field.required && (value === null || value === undefined);
                return (
                  <div key={field.key} className="space-y-2">
                    <Label htmlFor={`map-${field.key}`}>
                      {field.label}
                      {field.required && <span className="ml-1 text-destructive">*</span>}
                    </Label>
                    <Select
                      value={value === null || value === undefined ? NO_COLUMN : String(value)}
                      onValueChange={(next) => updateMapping(field.key, next)}
                    >
                      <SelectTrigger
                        id={`map-${field.key}`}
                        className="w-full"
                        aria-invalid={missing ? true : undefined}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_COLUMN}>— Ne pas importer —</SelectItem>
                        {preview.headers.map((header, index) => (
                          <SelectItem key={`${header}-${index}`} value={String(index)}>
                            {header || `Colonne ${index + 1}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
                  </div>
                );
              })}

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="categorie-import">Catégorie à appliquer</Label>
                <Select value={categorie || NO_CATEGORY} onValueChange={updateCategorie}>
                  <SelectTrigger id="categorie-import" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CATEGORY}>— Laisser à classer —</SelectItem>
                    {PRODUIT_CATEGORIES.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Le référentiel CNOPS ne contient que des médicaments : « Pharmaceutique »
                  s&apos;applique alors à toutes les lignes. Sans choix, la catégorie reste vide et
                  la TVA ne pourra pas être déduite.
                </p>
              </div>
            </div>

            {preview.colonnesIgnorees.length > 0 && (
              <div className="mt-sp-lg flex flex-wrap items-center gap-sp-xs">
                <span className="text-sm text-muted-foreground">Colonnes non reprises :</span>
                {preview.colonnesIgnorees.map((column) => (
                  <Badge key={column} variant="outline" className="text-muted-foreground">
                    {column}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl bg-card p-6 shadow-card">
            <h2 className="font-heading text-lg font-bold">Aperçu du fichier</h2>
            <div className="mt-sp-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    {preview.headers.map((header, index) => (
                      <TableHead
                        key={`${header}-${index}`}
                        className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                      >
                        {header || `Col. ${index + 1}`}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.apercu.map((row, rowIndex) => (
                    <TableRow key={rowIndex}>
                      {preview.headers.map((_, columnIndex) => (
                        <TableCell key={columnIndex} className="whitespace-nowrap text-sm">
                          {row[columnIndex] ?? ""}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <DuplicateList doublons={preview.doublons} />
          <RejectionList rejets={preview.rejets} />

          {preview.champsManquants.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                Associez d&apos;abord :{" "}
                {preview.champsManquants.map((field) => field.label).join(", ")}.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={reset}>
              Annuler
            </Button>
            <Button
              onClick={confirmImport}
              disabled={pending || preview.champsManquants.length > 0 || preview.aCreer === 0}
            >
              <Upload />
              {pending
                ? "Import en cours..."
                : `Importer ${preview.aCreer.toLocaleString("fr-MA")} fiche${preview.aCreer > 1 ? "s" : ""}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function DuplicateList({ doublons }: { doublons: ImportPreview["doublons"] }) {
  if (doublons.length === 0) return null;

  return (
    <div className="rounded-xl bg-card p-6 shadow-card">
      <div className="flex items-center gap-sp-sm">
        <AlertTriangle className="size-4 text-amber-600" />
        <h2 className="font-heading text-lg font-bold">
          {doublons.length} doublon{doublons.length > 1 ? "s" : ""}
        </h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Ces lignes ne seront pas importées. Une fiche existante n&apos;est jamais écrasée par un
        import — modifiez-la depuis le catalogue si besoin.
      </p>
      <ul className="mt-sp-md space-y-1 text-sm">
        {doublons.slice(0, 20).map((duplicate) => (
          <li key={`${duplicate.ligne}-${duplicate.codeBarres}`} className="flex gap-sp-sm">
            <span className="w-16 shrink-0 text-muted-foreground">L. {duplicate.ligne}</span>
            <span className="font-mono text-xs text-muted-foreground">{duplicate.codeBarres}</span>
            <span className="truncate">{duplicate.nom}</span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {duplicate.origine === "catalogue" ? "déjà au catalogue" : "répété dans le fichier"}
            </span>
          </li>
        ))}
      </ul>
      {doublons.length > 20 && (
        <p className="mt-sp-sm text-xs text-muted-foreground">
          … et {doublons.length - 20} autre{doublons.length - 20 > 1 ? "s" : ""}.
        </p>
      )}
    </div>
  );
}

function RejectionList({ rejets }: { rejets: ImportPreview["rejets"] }) {
  if (rejets.length === 0) return null;

  return (
    <div className="rounded-xl bg-card p-6 shadow-card">
      <div className="flex items-center gap-sp-sm">
        <AlertTriangle className="size-4 text-destructive" />
        <h2 className="font-heading text-lg font-bold">
          {rejets.length} ligne{rejets.length > 1 ? "s" : ""} en erreur
        </h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Les numéros correspondent aux lignes du tableur.
      </p>
      <ul className="mt-sp-md space-y-1 text-sm">
        {rejets.slice(0, 20).map((rejection) => (
          <li key={`${rejection.ligne}-${rejection.motif}`} className="flex gap-sp-sm">
            <span className="w-16 shrink-0 text-muted-foreground">L. {rejection.ligne}</span>
            <span className="truncate">{rejection.motif}</span>
          </li>
        ))}
      </ul>
      {rejets.length > 20 && (
        <p className="mt-sp-sm text-xs text-muted-foreground">
          … et {rejets.length - 20} autre{rejets.length - 20 > 1 ? "s" : ""}.
        </p>
      )}
    </div>
  );
}
