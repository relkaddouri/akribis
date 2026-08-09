import Image from "next/image";
import Link from "next/link";
import {
  BarChart3,
  ClipboardList,
  MapPin,
  MessageCircle,
  Package,
  Sparkles,
  Tag,
  Users,
  WifiOff,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardPreview } from "@/components/features/marketing/dashboard-preview";

const FEATURES: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: Package,
    title: "Gestion du stock en temps réel",
    description: "Suivez vos quantités, vos péremptions et vos alertes de stock bas en un coup d'œil.",
  },
  {
    icon: ShoppingCart,
    title: "Point de vente rapide",
    description: "Encaissez vos ventes en quelques secondes, avec ou sans client associé.",
  },
  {
    icon: WifiOff,
    title: "Fonctionne hors ligne",
    description:
      "Continuez à vendre même en cas de coupure internet : tout se synchronise dès le retour du réseau.",
  },
  {
    icon: Users,
    title: "Gestion clients",
    description: "Gardez un historique d'achats et retrouvez vos clients fidèles en un instant.",
  },
  {
    icon: ClipboardList,
    title: "Commandes fournisseurs",
    description: "Passez et suivez vos commandes fournisseurs, avec réception partielle ou complète.",
  },
  {
    icon: BarChart3,
    title: "Rapports détaillés",
    description: "Suivez la valeur de votre stock et vos ventes pour piloter votre pharmacie sereinement.",
  },
];

const REASONS: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: MapPin,
    title: "Adapté au marché marocain",
    description: "Pensé pour les pharmacies indépendantes au Maroc, avec leurs contraintes et leurs habitudes.",
  },
  {
    icon: Sparkles,
    title: "Simple à prendre en main",
    description: "Une interface claire, sans formation compliquée ni jargon technique.",
  },
  {
    icon: Tag,
    title: "Prix accessible",
    description: "Une solution pensée pour les pharmacies indépendantes, sans les coûts des grands logiciels.",
  },
  {
    icon: MessageCircle,
    title: "Support en français",
    description: "Une équipe qui vous répond dans votre langue, quand vous en avez besoin.",
  },
];

export function LandingPage() {
  return (
    <div className="bg-background">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/icon.svg" alt="" width={40} height={40} className="size-10" />
            <span className="font-heading text-lg font-semibold text-foreground">Akribis</span>
          </Link>
          <Button asChild variant="outline">
            <Link href="/login">Connexion</Link>
          </Button>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div className="space-y-6 text-center lg:text-left">
              <h1 className="text-4xl text-foreground sm:text-5xl">
                La gestion de pharmacie, enfin simple.
              </h1>
              <p className="text-lg text-muted-foreground">
                Akribis est le logiciel de gestion de stock pensé pour les pharmacies marocaines : simple à
                prendre en main, adapté aux réalités du terrain, et qui continue de fonctionner même sans
                connexion internet.
              </p>
              <div className="flex justify-center lg:justify-start">
                <Button asChild size="lg">
                  <Link href="/inscription">Essayer gratuitement</Link>
                </Button>
              </div>
            </div>
            <DashboardPreview />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl text-foreground">
              Tout ce qu&apos;il faut pour gérer votre pharmacie
            </h2>
            <p className="mt-3 text-muted-foreground">
              Une seule application pour le stock, la caisse, les clients et les commandes.
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <Card key={title}>
                <CardContent className="space-y-3">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-emerald-50 text-primary">
                    <Icon className="size-5" strokeWidth={1.75} />
                  </span>
                  <h3 className="text-foreground">{title}</h3>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="bg-card py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl text-foreground">Pourquoi Akribis ?</h2>
            </div>

            <div className="mt-12 grid gap-8 sm:grid-cols-2">
              {REASONS.map(({ icon: Icon, title, description }) => (
                <div key={title} className="flex gap-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-primary">
                    <Icon className="size-5" strokeWidth={1.75} />
                  </span>
                  <div>
                    <h3 className="text-foreground">{title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl text-foreground">Tarifs</h2>
            <p className="mt-3 text-muted-foreground">
              Notre grille tarifaire est encore en préparation — contactez-nous pour en discuter.
            </p>
          </div>

          <Card className="mx-auto mt-12 max-w-md">
            <CardContent className="space-y-4 text-center">
              <h3 className="text-lg text-foreground">Akribis</h3>
              <p className="text-sm text-muted-foreground">
                Une tarification pensée pour les pharmacies indépendantes, communiquée prochainement.
              </p>
              <Button asChild className="w-full">
                <a href="mailto:contact@akribis.ma">Nous contacter</a>
              </Button>
            </CardContent>
          </Card>
        </section>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            <Image src="/icon.svg" alt="" width={28} height={28} className="size-7" />
            <span className="font-medium text-foreground">Akribis</span>
          </div>
          <nav className="flex items-center gap-6">
            <a href="#" className="hover:text-foreground hover:underline">
              Mentions légales
            </a>
            <a href="mailto:contact@akribis.ma" className="hover:text-foreground hover:underline">
              Contact
            </a>
          </nav>
          <p>© {new Date().getFullYear()} Akribis. Tous droits réservés.</p>
        </div>
      </footer>
    </div>
  );
}
