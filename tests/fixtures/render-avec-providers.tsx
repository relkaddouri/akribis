import type { ReactElement, ReactNode } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DashboardUserProvider } from "@/components/providers/dashboard-user-provider";

/**
 * Rend un composant avec le contexte que l'application lui fournit
 * réellement.
 *
 * Sans QueryClientProvider, tout composant appelant `useQueryClient` lève
 * — c'est ce qui a cassé d'un coup les tests de la fiche et du tableau le
 * jour où l'interrupteur de désactivation y est entré. Le manque venait du
 * test, pas du composant : l'application monte bien ce fournisseur, dans
 * app/(dashboard)/layout.tsx.
 *
 * Chaque appel crée un QueryClient neuf pour qu'aucun cache ne fuite d'un
 * test à l'autre, et coupe les nouvelles tentatives, qui transformeraient
 * une erreur attendue en attente.
 *
 * `utilisateur` permet de changer le rôle : plusieurs écrans n'affichent
 * pas la même chose à un titulaire et à un assistant.
 */
export function renderAvecProviders(
  ui: ReactElement,
  options: { utilisateur?: { name: string; email: string; role: "owner" | "assistant" } } = {},
) {
  const utilisateur = options.utilisateur ?? {
    name: "Titulaire",
    email: "owner@akribis.test",
    role: "owner" as const,
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <DashboardUserProvider user={utilisateur}>
        <TooltipProvider>{children}</TooltipProvider>
      </DashboardUserProvider>
    </QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}
