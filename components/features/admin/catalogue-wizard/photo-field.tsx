"use client";

import { useRef, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, Star, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadCataloguePhotos } from "@/lib/server/catalogue-photo";
import {
  CATALOGUE_PHOTO_ACCEPT,
  MAX_CATALOGUE_PHOTOS,
  MAX_CATALOGUE_PHOTO_SIZE_BYTES,
  formatMegabytes,
  moveItem,
  rejectionReason,
} from "@/lib/catalogue/photo-rules";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Multi-photo picker for a catalogue fiche.
 *
 * Order in the list is the order stored: the first thumbnail is the photo
 * principale, marked as such, and it is what the catalogue list and the
 * POS will show. Reordering is arrow buttons rather than drag-and-drop —
 * they work with a keyboard and a screen reader, and this list is six
 * items long at most, where dragging buys very little.
 *
 * Uploads happen immediately, on drop; the fiche itself is saved later.
 * Removing a thumbnail therefore only drops the reference — the object
 * stays in the bucket. Deleting it there and then would break the fiche
 * of anyone who removed a photo and then abandoned the form, so an
 * orphaned object is the cheaper mistake.
 */
export function CataloguePhotoField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (photos: string[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const remaining = MAX_CATALOGUE_PHOTOS - value.length;
  const full = remaining <= 0;

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList);
    const issues: string[] = [];

    // Checked here as well as on the server: telling someone their file is
    // 12 Mo before a 12 Mo upload is the whole point.
    const valid = files.filter((file) => {
      const reason = rejectionReason(file);
      if (reason) issues.push(reason);
      return !reason;
    });

    const accepted = valid.slice(0, remaining);
    if (valid.length > accepted.length) {
      issues.push(
        `${valid.length - accepted.length} photo(s) ignorée(s) : maximum ${MAX_CATALOGUE_PHOTOS} par produit.`,
      );
    }

    setProblems(issues);
    if (accepted.length === 0) return;

    const formData = new FormData();
    for (const file of accepted) formData.append("files", file);

    startTransition(async () => {
      const result = await uploadCataloguePhotos(formData);
      if (!result.ok) {
        setProblems((current) => [...current, result.error]);
        return;
      }
      if (result.rejets.length > 0) {
        setProblems((current) => [...current, ...result.rejets]);
      }
      if (result.photos.length > 0) {
        onChange([...value, ...result.photos.map((photo) => photo.url)]);
      }
    });
  }

  return (
    <div className="space-y-sp-sm sm:col-span-2">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!full) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!full) handleFiles(event.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-sp-xs rounded-xl border border-dashed px-sp-md py-sp-lg text-center transition-colors",
          dragging ? "border-primary bg-accent" : "border-border bg-muted/40",
          full && "opacity-60",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={CATALOGUE_PHOTO_ACCEPT}
          className="hidden"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
        />

        {pending ? (
          <Loader2 className="size-6 animate-spin text-primary" strokeWidth={1.5} />
        ) : (
          <Upload className="size-6 text-muted-foreground" strokeWidth={1.5} />
        )}

        <p className="text-sm font-medium text-foreground">
          {full
            ? `Maximum atteint (${MAX_CATALOGUE_PHOTOS} photos)`
            : "Glissez vos photos ici, ou"}
        </p>

        {!full && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus />
            {pending ? "Envoi..." : "Choisir des fichiers"}
          </Button>
        )}

        <p className="text-xs text-muted-foreground">
          jpg, png ou webp · {formatMegabytes(MAX_CATALOGUE_PHOTO_SIZE_BYTES)} par fichier ·{" "}
          {value.length}/{MAX_CATALOGUE_PHOTOS} utilisée{value.length > 1 ? "s" : ""}
        </p>
      </div>

      {problems.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="space-y-0.5">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {value.length > 0 && (
        <ul className="grid grid-cols-3 gap-sp-sm sm:grid-cols-4">
          {value.map((url, index) => (
            <li
              key={url}
              className="group relative aspect-square overflow-hidden rounded-lg bg-muted ring-1 ring-border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, not a local asset */}
              <img
                src={url}
                alt={index === 0 ? "Photo principale" : `Photo ${index + 1}`}
                className="size-full object-cover"
              />

              {index === 0 && (
                <span className="absolute top-1 left-1 flex items-center gap-1 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  <Star className="size-2.5 fill-current" strokeWidth={0} aria-hidden />
                  Principale
                </span>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onChange(value.filter((_, position) => position !== index))}
                    aria-label={`Supprimer la photo ${index + 1}`}
                    className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-md bg-background/90 text-muted-foreground transition-colors hover:bg-destructive hover:text-white"
                  >
                    <X className="size-3.5" strokeWidth={2} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Supprimer</TooltipContent>
              </Tooltip>

              <div className="absolute inset-x-1 bottom-1 flex justify-between gap-1">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => onChange(moveItem(value, index, index - 1))}
                  aria-label={`Déplacer la photo ${index + 1} vers la gauche`}
                  className="flex size-6 items-center justify-center rounded-md bg-background/90 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:invisible"
                >
                  <ArrowLeft className="size-3.5" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  disabled={index === value.length - 1}
                  onClick={() => onChange(moveItem(value, index, index + 1))}
                  aria-label={`Déplacer la photo ${index + 1} vers la droite`}
                  className="flex size-6 items-center justify-center rounded-md bg-background/90 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:invisible"
                >
                  <ArrowRight className="size-3.5" strokeWidth={2} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {value.length > 1 && (
        <p className="text-xs text-muted-foreground">
          La première photo est celle qui s&apos;affiche dans les listes et à la caisse.
        </p>
      )}
    </div>
  );
}
