import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AdminSidebar } from "@/components/features/admin/admin-sidebar";
import { DashboardSidebar } from "@/components/features/dashboard/dashboard-sidebar";

/**
 * Both sidebars now share one shell (components/ui/app-sidebar.tsx). These
 * tests exist because that shell was extracted *from* the pharmacy sidebar:
 * the refactor must not have dropped an item, a section, or the collapse
 * behaviour on the side that already worked.
 */

const pathname = vi.hoisted(() => ({ current: "/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

vi.mock("@/components/features/dashboard/use-dashboard-counts", () => ({
  useDashboardCounts: () => ({ unreadNews: 3, dueReminders: 2 }),
}));

const signOut = vi.fn();
vi.mock("@/lib/auth/actions", () => ({ signOutAction: () => signOut() }));

beforeEach(() => {
  pathname.current = "/dashboard";
  document.cookie = "akribis-sidebar-collapsed=; path=/; max-age=0";
});

describe("sidebar pharmacie — inchangée après extraction du socle", () => {
  const PHARMACY_ITEMS = [
    "Tableau de bord",
    "Stock",
    "Caisse",
    "Ventes",
    "Clients",
    "Commandes",
    "Factures",
    "Rappels",
    "Inventaire",
  ];

  it("garde tous ses items de menu", () => {
    render(<DashboardSidebar role="owner" />);
    for (const label of PHARMACY_ITEMS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("garde ses sections, sa recherche et son fil d'actualité", () => {
    render(<DashboardSidebar role="owner" />);
    expect(screen.getByText("Menu")).toBeInTheDocument();
    expect(screen.getByText("Akribis actualités")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Rechercher/i)).toBeInTheDocument();
  });

  /**
   * La section « Outils » — Akribis Intelligence, Labo, Medical — a été
   * retirée sur demande. C'étaient trois entrées désactivées, sans route,
   * annonçant des produits à venir ; elles occupaient le bas de la barre
   * sans que rien ne s'y clique.
   *
   * Le module AKRIBIS_TOOLS, lui, reste : le fil d'actualités s'en sert
   * pour les pastilles des annonces Suite, et le supprimer les aurait
   * cassées. Ce test dit lequel des deux a disparu.
   */
  it("n'affiche plus la section Outils", () => {
    render(<DashboardSidebar role="owner" />);
    expect(screen.queryByText("Outils")).not.toBeInTheDocument();
    for (const outil of ["Akribis Intelligence", "Akribis Labo", "Akribis Medical"]) {
      expect(screen.queryByText(outil)).not.toBeInTheDocument();
    }
  });

  it("affiche les badges de compteur", () => {
    render(<DashboardSidebar role="owner" />);
    expect(screen.getByText("3")).toBeInTheDocument(); // actualités non lues
    expect(screen.getByText("2")).toBeInTheDocument(); // rappels du jour
  });

  it("réserve Rapports et Paramètres au titulaire", () => {
    const { unmount } = render(<DashboardSidebar role="owner" />);
    expect(screen.getByText("Rapports")).toBeInTheDocument();
    expect(screen.getByText("Paramètres")).toBeInTheDocument();
    unmount();

    render(<DashboardSidebar role="assistant" />);
    expect(screen.queryByText("Rapports")).not.toBeInTheDocument();
    expect(screen.queryByText("Paramètres")).not.toBeInTheDocument();
  });

  it("replie et déplie, en mémorisant le choix dans un cookie", () => {
    render(<DashboardSidebar role="owner" />);

    fireEvent.click(screen.getByLabelText("Réduire le menu"));
    expect(screen.queryByText("Tableau de bord")).not.toBeInTheDocument();
    expect(document.cookie).toContain("akribis-sidebar-collapsed=1");

    fireEvent.click(screen.getByLabelText("Étendre le menu"));
    expect(screen.getByText("Tableau de bord")).toBeInTheDocument();
    expect(document.cookie).toContain("akribis-sidebar-collapsed=0");
  });

  it("s'ouvre déjà repliée quand le cookie le dit", () => {
    render(<DashboardSidebar role="owner" defaultCollapsed />);
    expect(screen.queryByText("Tableau de bord")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Étendre le menu")).toBeInTheDocument();
  });
});

describe("sidebar admin", () => {
  beforeEach(() => {
    pathname.current = "/admin/catalogue";
  });

  it("porte le sous-label « Admin », pas « Pharma »", () => {
    render(<AdminSidebar />);
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("akribis")).toBeInTheDocument();
    expect(screen.queryByText(/Pharma/)).not.toBeInTheDocument();
  });

  it("montre le catalogue et les sections à venir", () => {
    render(<AdminSidebar />);
    expect(screen.getByText("Menu")).toBeInTheDocument();
    expect(screen.getByText("À venir")).toBeInTheDocument();
    for (const label of ["Catalogue produits", "Suggestions", "Comptes pharmacies", "Abonnements"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("désactive les fonctionnalités à venir plutôt que de les faire cliquer dans le vide", () => {
    render(<AdminSidebar />);
    for (const label of ["Suggestions", "Comptes pharmacies", "Abonnements", "Paramètres"]) {
      expect(screen.getByText(label).closest("button")).toBeDisabled();
    }
    // Le catalogue, lui, est un vrai lien.
    expect(screen.getByText("Catalogue produits").closest("a")).toHaveAttribute(
      "href",
      "/admin/catalogue",
    );
  });

  it("n'emporte rien de l'espace pharmacie", () => {
    render(<AdminSidebar />);
    for (const label of ["Caisse", "Stock", "Clients", "Akribis actualités", "Outils"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    expect(screen.queryByPlaceholderText(/Rechercher/i)).not.toBeInTheDocument();
  });

  it("déconnecte depuis le bas de la barre", () => {
    render(<AdminSidebar />);
    fireEvent.click(screen.getByText("Déconnexion"));
    expect(signOut).toHaveBeenCalled();
  });

  it("se replie comme celle de la pharmacie", () => {
    render(<AdminSidebar />);
    fireEvent.click(screen.getByLabelText("Réduire le menu"));
    expect(screen.queryByText("Catalogue produits")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Étendre le menu")).toBeInTheDocument();
  });
});
