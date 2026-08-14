import { Settings } from "lucide-react";
import { getPharmacySettings } from "@/lib/server/pharmacy";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { PharmacyInfoForm } from "@/components/features/settings/pharmacy-info-form";
import { ReceiptSettingsForm } from "@/components/features/settings/receipt-settings-form";
import { InviteAssistantForm } from "@/components/features/auth/invite-assistant-form";
import { ConflictLogView } from "@/components/features/offline/conflict-log-view";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function ParametresPage() {
  // requireOwner() runs inside getPharmacySettings() — belt and suspenders
  // on top of the middleware, since this page renders privileged actions.
  const pharmacy = await getPharmacySettings();

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader title="Paramètres" icon={<Settings />} />

      <div className="space-y-sp-lg">
        <Tabs defaultValue="informations">
          <TabsList>
            <TabsTrigger value="informations">Informations</TabsTrigger>
            <TabsTrigger value="ticket">Ticket de caisse</TabsTrigger>
            <TabsTrigger value="utilisateurs">Utilisateurs</TabsTrigger>
          </TabsList>

          <TabsContent value="informations" className="max-w-2xl">
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

          <TabsContent value="ticket" className="max-w-5xl">
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

          <TabsContent value="utilisateurs" className="max-w-2xl space-y-sp-lg">
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

            <ConflictLogView />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
