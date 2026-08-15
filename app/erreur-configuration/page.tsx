import Image from "next/image";
import { TriangleAlert } from "lucide-react";

/**
 * Shown when the middleware finds the app misconfigured — a missing
 * Supabase environment variable, typically.
 *
 * Static on purpose: no `cookies()`, no data, no auth. A page that
 * explains a configuration failure must not depend on the configuration
 * that failed, or it takes the whole app down with it.
 */
export const dynamic = "force-static";

export const metadata = {
  title: "Configuration incomplète — Akribis",
};

export default function ConfigurationErrorPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-sp-lg">
      <div className="w-full max-w-md space-y-sp-lg text-center">
        <Image src="/icon.svg" alt="" width={56} height={56} className="mx-auto size-14" />

        <div className="space-y-sp-sm">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <TriangleAlert className="size-6" strokeWidth={1.75} aria-hidden />
          </span>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            L&apos;application n&apos;est pas correctement configurée
          </h1>
          <p className="text-sm text-muted-foreground">
            Elle ne peut pas joindre son service d&apos;authentification. Ce n&apos;est pas un
            problème de votre côté — l&apos;administrateur doit compléter la configuration du
            serveur.
          </p>
        </div>

        <div className="rounded-xl bg-card p-sp-md text-left shadow-soft">
          <p className="text-sm font-medium text-foreground">Pour l&apos;administrateur</p>
          <p className="mt-sp-xs text-sm text-muted-foreground">
            Une variable d&apos;environnement Supabase est absente au moment du build. Le détail
            exact est dans les journaux du serveur, préfixé{" "}
            <code className="rounded bg-muted px-sp-xs py-px text-xs">[middleware]</code>.
          </p>
          <p className="mt-sp-sm text-xs text-muted-foreground">
            Rappel : les variables <code>NEXT_PUBLIC_*</code> sont figées dans le bundle au
            moment du build. Les ajouter après coup n&apos;a aucun effet tant que le projet
            n&apos;est pas redéployé.
          </p>
        </div>
      </div>
    </main>
  );
}
