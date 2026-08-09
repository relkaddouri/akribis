"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  FEED_FILTERS,
  filterPublications,
  type FeedFilter,
  type PublicationItem,
} from "@/lib/news/publications";
import { markPublicationsRead } from "@/lib/server/publications";
import { PublicationCard } from "@/components/features/news/publication-card";

/** How long a card must stay on screen before it counts as actually seen. */
const MARK_READ_DELAY_MS = 1500;

export function NewsFeed({ publications }: { publications: PublicationItem[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<FeedFilter>("tous");
  /**
   * Ids marked read during this session. Kept separately from
   * `publication.lu` so the ring can disappear immediately, before the
   * server round-trip and refresh land.
   */
  const [locallyRead, setLocallyRead] = useState<ReadonlySet<string>>(new Set());

  const visible = useMemo(() => filterPublications(publications, filter), [publications, filter]);

  const isUnread = useCallback(
    (publication: PublicationItem) => !publication.lu && !locallyRead.has(publication.id),
    [locallyRead],
  );

  // Ids seen on screen long enough but not yet flushed to the server.
  const pendingRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const flush = useCallback(async () => {
    const ids = [...pendingRef.current];
    if (ids.length === 0) return;
    pendingRef.current.clear();

    setLocallyRead((previous) => new Set([...previous, ...ids]));
    try {
      await markPublicationsRead(ids);
      // Re-render the layout so the sidebar's unread badge picks up the
      // new count; the optimistic state above already updated the rings.
      router.refresh();
    } catch {
      // Offline or a failed write: put them back so a later pass retries,
      // and restore the unread ring rather than claiming they were read.
      for (const id of ids) pendingRef.current.add(id);
      setLocallyRead((previous) => {
        const next = new Set(previous);
        for (const id of ids) next.delete(id);
        return next;
      });
    }
  }, [router]);

  useEffect(() => {
    const timers = timersRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.publicationId;
          if (!id) continue;

          if (entry.isIntersecting) {
            if (timers.has(id)) continue;
            timers.set(
              id,
              setTimeout(() => {
                timers.delete(id);
                pendingRef.current.add(id);
                void flush();
              }, MARK_READ_DELAY_MS),
            );
          } else {
            // Scrolled back out before the delay elapsed — it wasn't read.
            const timer = timers.get(id);
            if (timer) {
              clearTimeout(timer);
              timers.delete(id);
            }
          }
        }
      },
      { threshold: 0.5 },
    );

    for (const node of document.querySelectorAll("[data-publication-id][data-unread]")) {
      observer.observe(node);
    }

    return () => {
      observer.disconnect();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
    // Re-observing on `visible` keeps newly-rendered cards (after a tab
    // switch) tracked; `locallyRead` drops the ones already handled.
  }, [flush, visible, locallyRead]);

  return (
    <div className="space-y-sp-lg">
      <div role="tablist" aria-label="Filtrer les actualités" className="flex flex-wrap gap-sp-sm">
        {FEED_FILTERS.map((tab) => {
          const active = tab.value === filter;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(tab.value)}
              className={cn(
                "rounded-4xl px-sp-md py-sp-sm text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground shadow-soft hover:bg-muted hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl bg-card p-sp-2xl text-center shadow-card">
          <p className="font-heading font-semibold text-foreground">Aucune publication</p>
          <p className="mt-sp-sm text-sm text-muted-foreground">
            Rien à afficher dans cette catégorie pour le moment.
          </p>
        </div>
      ) : (
        <div className="space-y-sp-md">
          {visible.map((publication) => (
            <PublicationCard
              key={publication.id}
              publication={publication}
              unread={isUnread(publication)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
