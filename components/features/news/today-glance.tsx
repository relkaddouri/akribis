import Link from "next/link";
import {
  Boxes,
  CircleHelp,
  ClipboardList,
  PackagePlus,
  ShoppingCart,
  TriangleAlert,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TodayGlance as TodayGlanceData } from "@/lib/server/today";

type Shortcut = {
  label: string;
  icon: LucideIcon;
  /** Null when the destination doesn't exist yet — rendered disabled rather than linking to a 404. */
  href: string | null;
};

const SHORTCUTS: Shortcut[] = [
  { label: "Nouvelle vente", icon: ShoppingCart, href: "/dashboard/pos" },
  { label: "Ajouter un produit", icon: PackagePlus, href: "/dashboard/stock/produits/nouveau" },
  { label: "Nouvelle commande", icon: ClipboardList, href: "/dashboard/commandes/nouvelle" },
  { label: "Ajouter un client", icon: UserPlus, href: "/dashboard/clients" },
  // The Inventaire module isn't built yet — it's the disabled sidebar item.
  { label: "Démarrer un inventaire", icon: Boxes, href: null },
  { label: "Voir les alertes stock", icon: TriangleAlert, href: "/dashboard/stock" },
];

const shortcutClass =
  "flex flex-col items-center gap-sp-sm rounded-lg bg-card p-sp-md text-center shadow-soft transition-colors";

function ShortcutTile({ shortcut }: { shortcut: Shortcut }) {
  const Icon = shortcut.icon;
  const content = (
    <>
      <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-primary">
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <span className="text-xs leading-tight font-medium">{shortcut.label}</span>
    </>
  );

  if (!shortcut.href) {
    return (
      <span
        className={cn(shortcutClass, "cursor-default text-muted-foreground/60")}
        title="Module à venir"
        aria-disabled
      >
        {content}
      </span>
    );
  }

  return (
    <Link
      href={shortcut.href}
      className={cn(shortcutClass, "text-foreground hover:bg-muted")}
    >
      {content}
    </Link>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-sp-md rounded-lg bg-card px-sp-md py-sp-sm shadow-soft">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate font-heading text-sm font-bold text-foreground">{value}</span>
    </div>
  );
}

export function TodayGlance({ glance }: { glance: TodayGlanceData }) {
  return (
    <div className="space-y-sp-lg">
      <section className="space-y-sp-md">
        <h2 className="font-heading text-base font-bold text-foreground">
          Aujourd&apos;hui en un coup d&apos;œil
        </h2>
        <div className="grid grid-cols-2 gap-sp-sm">
          {SHORTCUTS.map((shortcut) => (
            <ShortcutTile key={shortcut.label} shortcut={shortcut} />
          ))}
        </div>
      </section>

      <section className="space-y-sp-sm">
        <MiniStat label="Ventes du jour" value={`${glance.salesTotal.toFixed(2)} MAD`} />
        <MiniStat label="Produits en alerte" value={String(glance.lowStockCount)} />
        <MiniStat
          label="Plus vendu aujourd'hui"
          value={glance.topProduct ? glance.topProduct.name : "—"}
        />
      </section>

      <section className="rounded-lg bg-card p-sp-md shadow-soft">
        <div className="flex items-center gap-sp-sm">
          <CircleHelp className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <p className="text-sm font-medium text-foreground">Besoin d&apos;aide ?</p>
        </div>
        <p className="mt-sp-sm text-xs text-muted-foreground">
          Notre équipe vous accompagne sur toutes vos questions.
        </p>
        {/* The Support page doesn't exist yet — it's the disabled sidebar
            item. Rendered inert rather than linked to a 404; swap in a
            <Link href="/support"> once that route lands. */}
        <span
          className="mt-sp-sm inline-block cursor-default text-xs font-medium text-muted-foreground/60"
          aria-disabled
          title="Page à venir"
        >
          Contacter le support
        </span>
      </section>
    </div>
  );
}
