"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CataloguePhotoRecord } from "@/lib/server/catalogue";

/**
 * Photo viewer for a catalogue fiche.
 *
 * Three shapes, because a control that does nothing is worse than no
 * control: no photo shows a neutral tile, one photo shows just the photo,
 * and only several photos bring arrows, thumbnails and a counter.
 *
 * Photos arrive already ordered by the server (ordre, then dateAjout), so
 * index 0 is the photo principale — no sorting happens here.
 */
export function CataloguePhotoCarousel({
  photos,
  alt,
}: {
  photos: CataloguePhotoRecord[] | null | undefined;
  alt: string;
}) {
  const list = photos ?? [];
  const [index, setIndex] = useState(0);
  const [broken, setBroken] = useState<Set<string>>(new Set());

  // A fiche can lose photos while the page is open (another admin editing,
  // a router.refresh()); without this the index could point past the end
  // and the viewer would go blank.
  useEffect(() => {
    setIndex((current) => (current >= list.length ? 0 : current));
  }, [list.length]);

  if (list.length === 0) {
    return <EmptyFrame />;
  }

  const safeIndex = Math.min(index, list.length - 1);
  const current = list[safeIndex]!;
  const single = list.length === 1;

  const go = (next: number) => setIndex((next + list.length) % list.length);

  return (
    <div className="space-y-sp-sm">
      <div className="relative aspect-4/3 overflow-hidden rounded-xl bg-muted">
        {broken.has(current.url) ? (
          <EmptyFrame inline />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, not a local asset
          <img
            src={current.url}
            alt={single ? alt : `${alt} — photo ${safeIndex + 1} sur ${list.length}`}
            onError={() => setBroken((set) => new Set(set).add(current.url))}
            className="size-full object-contain"
          />
        )}

        {!single && (
          <>
            <CarouselButton side="left" onClick={() => go(safeIndex - 1)} />
            <CarouselButton side="right" onClick={() => go(safeIndex + 1)} />

            <span
              className="absolute right-sp-sm bottom-sp-sm rounded-md bg-foreground/70 px-sp-sm py-0.5 text-xs font-medium text-background tabular-nums"
              aria-live="polite"
            >
              {safeIndex + 1}/{list.length}
            </span>
          </>
        )}
      </div>

      {!single && (
        <ul className="flex gap-sp-xs overflow-x-auto pb-1">
          {list.map((photo, position) => (
            <li key={photo.id}>
              <button
                type="button"
                onClick={() => setIndex(position)}
                aria-label={`Voir la photo ${position + 1}`}
                aria-current={position === safeIndex ? "true" : undefined}
                className={cn(
                  "size-14 shrink-0 overflow-hidden rounded-lg bg-muted ring-2 transition-colors",
                  position === safeIndex ? "ring-primary" : "ring-transparent hover:ring-border",
                )}
              >
                {broken.has(photo.url) ? (
                  <span className="flex size-full items-center justify-center text-muted-foreground">
                    <ImageOff className="size-4" strokeWidth={1.5} />
                  </span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, not a local asset
                  <img
                    src={photo.url}
                    alt=""
                    loading="lazy"
                    onError={() => setBroken((set) => new Set(set).add(photo.url))}
                    className="size-full object-cover"
                  />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CarouselButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Photo précédente" : "Photo suivante"}
      className={cn(
        "absolute top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-soft transition-colors hover:bg-background",
        side === "left" ? "left-sp-sm" : "right-sp-sm",
      )}
    >
      <Icon className="size-4" strokeWidth={2} />
    </button>
  );
}

/** Same neutral tile whether there is no photo or the file no longer loads. */
function EmptyFrame({ inline = false }: { inline?: boolean }) {
  const content = (
    <span className="flex flex-col items-center gap-sp-xs text-muted-foreground">
      <ImageOff className="size-8" strokeWidth={1.25} aria-hidden />
      <span className="text-sm">Aucune photo</span>
    </span>
  );

  if (inline) {
    return <span className="flex size-full items-center justify-center">{content}</span>;
  }

  return (
    <div className="flex aspect-4/3 items-center justify-center rounded-xl bg-muted">{content}</div>
  );
}
