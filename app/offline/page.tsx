import Image from "next/image";
import Link from "next/link";
import { CloudOff } from "lucide-react";

/**
 * The service worker's navigation fallback, served when a route is
 * requested with no network AND no cached copy — i.e. a page never opened
 * on this device while online.
 *
 * Deliberately free of `cookies()`, `requireUser()` and any data fetch, so
 * it prerenders to a static file at build time. A fallback that needed the
 * server would fail in exactly the situation it exists for.
 */
export const dynamic = "force-static";

export const metadata = {
  title: "Hors ligne — Akribis",
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-sp-lg">
      <div className="w-full max-w-md space-y-sp-lg text-center">
        <Image src="/icon.svg" alt="" width={56} height={56} className="mx-auto size-14" />

        <div className="space-y-sp-sm">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <CloudOff className="size-6" strokeWidth={1.75} aria-hidden />
          </span>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            Cette page n&apos;est pas disponible hors ligne
          </h1>
          <p className="text-sm text-muted-foreground">
            Elle n&apos;a pas encore été ouverte sur cet appareil avec une connexion, il n&apos;y
            a donc rien à afficher. Reconnectez-vous au réseau pour la charger une première
            fois.
          </p>
        </div>

        <div className="space-y-sp-sm rounded-xl bg-card p-sp-md text-left shadow-soft">
          <p className="text-sm font-medium text-foreground">
            Ce qui fonctionne sans connexion :
          </p>
          <ul className="space-y-sp-xs text-sm text-muted-foreground">
            <li>
              <Link href="/dashboard/pos" className="font-medium text-primary hover:underline">
                Caisse
              </Link>{" "}
              — encaisser une vente, imprimer le ticket
            </li>
            <li>
              <Link href="/dashboard/stock" className="font-medium text-primary hover:underline">
                Stock
              </Link>{" "}
              — consulter, ajouter et modifier un produit
            </li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Les écritures faites hors ligne sont conservées sur l&apos;appareil et envoyées
            automatiquement au retour du réseau.
          </p>
        </div>
      </div>
    </main>
  );
}
