import {
  Building2,
  CloudOff,
  ReceiptText,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { getPharmacySettings } from "@/lib/server/pharmacy";
import { listOrganismes } from "@/lib/server/organismes";
import { listEventLogPharmacie, optionsJournal } from "@/lib/server/audit";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { PharmacyInfoForm } from "@/components/features/settings/pharmacy-info-form";
import { ReceiptSettingsForm } from "@/components/features/settings/receipt-settings-form";
import { OrganismesSection } from "@/components/features/settings/organismes-section";
import { InviteAssistantForm } from "@/components/features/auth/invite-assistant-form";
import { ConflictLogView } from "@/components/features/offline/conflict-log-view";
import { SyncQueueMaintenance } from "@/components/features/offline/sync-queue-maintenance";
import { ProductResync } from "@/components/features/offline/product-resync";
import { JournalAuditSection } from "@/components/features/settings/journal-audit-section";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { SettingsNav, type SectionParametres } from "@/components/features/settings/settings-nav";

/**
 * Les sections, déclarées ici plutôt que dans la navigation : la page est
 * seule à savoir lesquelles existent, et une entrée sans panneau — ou
 * l'inverse — se verrait tout de suite en les tenant côte à côte.
 */
const SECTIONS: SectionParametres[] = [
  { value: "informations", label: "Informations", icon: <Building2 /> },
  { value: "ticket", label: "Ticket de caisse", icon: <ReceiptText /> },
  { value: "tiers-payant", label: "Tiers payant", icon: <ShieldCheck /> },
  { value: "utilisateurs", label: "Utilisateurs", icon: <Users /> },
  { value: "journal", label: "Journal d'audit", icon: <ScrollText /> },
  { value: "hors-ligne", label: "Hors ligne", icon: <CloudOff /> },
];

export default async function ParametresPage() {
  // Les deux façades appellent requireOwner(). /parametres est déjà réservé
  // au titulaire par le middleware ; chacune le revérifie pour son compte,
  // cette page rendant des actions privilégiées.
  const [pharmacy, organismes, journal, optionsFiltres] = await Promise.all([
    getPharmacySettings(),
    listOrganismes(),
    listEventLogPharmacie(),
    optionsJournal(),
  ]);

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader title="Paramètres" icon={<Settings />} />

      {/* En colonne sur écran large, empilé en dessous : à 5 sections la
          colonne tiendrait encore sur un portable, mais elle prendrait la
          moitié de la largeur utile. */}
      <Tabs
        defaultValue="informations"
        orientation="vertical"
        className="flex-col items-start gap-sp-lg lg:flex-row"
      >
        <Card className="w-full shrink-0 lg:w-64">
          <CardContent className="p-sp-sm">
            <SettingsNav sections={SECTIONS} />
          </CardContent>
        </Card>

        <div className="w-full min-w-0 flex-1 space-y-sp-lg">

          <TabsContent value="informations">
            <Card>
              <CardHeader>
                <CardTitle>Informations de la pharmacie</CardTitle>
                <CardDescription>
                  Ces informations peuvent apparaître sur les documents et le ticket de caisse.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PharmacyInfoForm pharmacy={pharmacy} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ticket">
            <Card>
              <CardHeader>
                <CardTitle>Paramétrage du ticket de caisse</CardTitle>
                <CardDescription>
                  Personnalisez ce qui est imprimé en bas du ticket remis au client.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ReceiptSettingsForm settings={pharmacy.receiptSettings} pharmacy={pharmacy} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Son propre onglet plutôt qu'une section de plus sous
              « Informations » : c'est une liste qu'on vient gérer, pas un
              formulaire qu'on remplit une fois. */}
          <TabsContent value="tiers-payant">
            <Card>
              <CardHeader>
                <CardTitle>Organismes tiers payant</CardTitle>
                <CardDescription>
                  Les organismes avec lesquels vous êtes conventionné. Le taux enregistré ici sert
                  de valeur par défaut et reste modifiable vente par vente.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <OrganismesSection organismes={organismes} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="utilisateurs" className="space-y-sp-lg">
            <Card>
              <CardHeader>
                <CardTitle>Inviter un assistant</CardTitle>
                <CardDescription>
                  L&apos;assistant recevra un e-mail pour activer son compte avec un accès limité
                  (pas de paramètres, pas de statistiques financières).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <InviteAssistantForm />
              </CardContent>
            </Card>

          </TabsContent>

          {/* Dans les Paramètres et non dans la barre latérale : c'est un
              registre qu'on vient consulter en cas de question, pas un
              module de travail quotidien. */}
          <TabsContent value="journal">
            <Card>
              <CardHeader>
                <CardTitle>Journal d&apos;audit</CardTitle>
                <CardDescription>
                  Qui a fait quoi, et quand. Chaque entrée est conservée définitivement : la
                  base refuse toute modification et toute suppression sur cette table.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <JournalAuditSection
                  entreesInitiales={journal}
                  acteurs={optionsFiltres.acteurs}
                  actions={optionsFiltres.actions}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Its own tab rather than tacked onto "Utilisateurs", where the
              conflict log used to sit: this is where someone goes when the
              sync badge is telling them something. */}
          <TabsContent value="hors-ligne" className="space-y-sp-lg">
            <SyncQueueMaintenance />
            <ProductResync />
            <ConflictLogView />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
