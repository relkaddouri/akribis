"use client";

import { cn } from "@/lib/utils";
import { formatRelativeDate, type PublicationItem } from "@/lib/news/publications";
import { AKRIBIS_TOOLS } from "@/components/features/dashboard/akribis-tools";
import { AvatarBadge } from "@/components/ui/avatar-badge";

/**
 * Category badge styling. Alerts are the only type whose colour varies —
 * it escalates with niveau_urgence, so a "faible" alert doesn't shout as
 * loudly as an "elevee" one.
 */
const TYPE_BADGE: Record<PublicationItem["type"], { label: string; className: string }> = {
  nouveaute: {
    label: "Nouveauté",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
  alerte: {
    label: "Alerte",
    className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  },
  maintenance: {
    label: "Maintenance",
    className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  annonce_suite: {
    label: "Akribis Suite",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
};

const URGENCE_BADGE: Record<NonNullable<PublicationItem["niveauUrgence"]>, string> = {
  faible: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  moyenne: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  elevee: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

function CategoryBadge({ publication }: { publication: PublicationItem }) {
  const base = TYPE_BADGE[publication.type];

  // An alert's colour comes from its urgency when one is set; a Suite
  // announcement borrows the colour of the tool it's about.
  const tool = publication.outilAssocie ? AKRIBIS_TOOLS[publication.outilAssocie] : null;
  const className =
    publication.type === "alerte" && publication.niveauUrgence
      ? URGENCE_BADGE[publication.niveauUrgence]
      : publication.type === "annonce_suite" && tool
        ? tool.circleClass
        : base.className;

  const label =
    publication.type === "alerte" && publication.niveauUrgence
      ? `Alerte · ${publication.niveauUrgence === "elevee" ? "élevée" : publication.niveauUrgence}`
      : base.label;

  const ToolIcon = tool?.icon;

  return (
    <div className="flex shrink-0 items-center gap-sp-xs">
      <span
        className={cn(
          "inline-flex items-center rounded-4xl px-sp-sm py-sp-xs text-xs font-medium whitespace-nowrap",
          className,
        )}
      >
        {label}
      </span>
      {ToolIcon && (
        <span
          className={cn(
            "relative flex size-6 shrink-0 items-center justify-center rounded-full",
            tool.circleClass,
          )}
          title={tool.label}
        >
          <ToolIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">{tool.label}</span>
        </span>
      )}
    </div>
  );
}

export function PublicationCard({
  publication,
  unread,
}: {
  publication: PublicationItem;
  /**
   * Read-state as the feed currently sees it — not `publication.lu`, so a
   * card can lose its unread ring the moment it's marked read without
   * waiting for a server round-trip.
   */
  unread: boolean;
}) {
  return (
    <article
      data-publication-id={publication.id}
      data-unread={unread || undefined}
      className={cn(
        "rounded-xl bg-card p-sp-lg shadow-card transition-colors",
        // The unread cue is a ring rather than a border: a border would
        // shift every card by 1px as it gets marked read.
        unread && "ring-2 ring-primary",
      )}
    >
      <header className="flex items-start justify-between gap-sp-md">
        <div className="flex items-center gap-sp-sm">
          <AvatarBadge name={publication.auteur} />
          <div className="leading-tight">
            <p className="text-sm font-medium text-foreground">{publication.auteur}</p>
            <p className="text-xs text-muted-foreground">
              {formatRelativeDate(publication.datePublication)}
            </p>
          </div>
        </div>
        <CategoryBadge publication={publication} />
      </header>

      <h2 className="mt-sp-md font-heading text-lg font-bold text-foreground">
        {publication.titre}
      </h2>
      <p className="mt-sp-sm line-clamp-3 text-sm text-muted-foreground">{publication.contenu}</p>

      {publication.imageUrl && (
        <div className="mt-sp-md overflow-hidden rounded-lg bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- editorial image on an arbitrary external host; next/image would need remotePatterns for each one (same call as product-table.tsx) */}
          <img
            src={publication.imageUrl}
            alt=""
            loading="lazy"
            className="aspect-video w-full object-cover"
          />
        </div>
      )}
    </article>
  );
}
