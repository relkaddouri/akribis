import type { ReactNode } from "react";
import { BadgeCheck, Home, ShieldCheck } from "lucide-react";
import type { ClientRecord } from "@/lib/server/clients";
import { LIBELLES_TYPE_CLIENT } from "@/lib/validations/clients";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * La fiche en consultation : les mêmes sections que le formulaire
 * d'édition, en lecture seule.
 *
 * Un champ vide s'affiche « Non renseigné », en gris. Le masquer ferait
 * disparaître la ligne et laisserait croire que le champ n'existe pas —
 * le pharmacien qui cherche le CIN d'un assuré doit voir qu'il manque,
 * pas se demander où il est passé.
 *
 * La section Crédit n'est pas ici : le plafond s'affiche à côté du solde,
 * dans ClientBalanceCard, parce que c'est du solde qu'il se déduit.
 */

function Champ({ libelle, valeur }: { libelle: string; valeur: ReactNode }) {
  const vide = valeur === null || valeur === undefined || valeur === "";
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{libelle}</dt>
      <dd
        className={
          vide
            ? "text-sm italic text-muted-foreground/70"
            : "text-sm break-words text-foreground"
        }
      >
        {vide ? "Non renseigné" : valeur}
      </dd>
    </div>
  );
}

function Section({
  titre,
  icone,
  children,
}: {
  titre: string;
  icone: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{icone}</span>
          {titre}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-sp-md sm:grid-cols-2">{children}</dl>
      </CardContent>
    </Card>
  );
}

export function ClientDetailsSections({
  client,
  organismeNom,
}: {
  client: ClientRecord;
  /** Le nom de l'organisme d'affiliation, `null` si aucun. */
  organismeNom: string | null;
}) {
  return (
    <div className="grid gap-sp-md lg:grid-cols-3">
      <Section titre="Identité" icone={<BadgeCheck className="size-4" />}>
        <Champ libelle="Nom" valeur={client.name} />
        <Champ
          libelle="Type de client"
          valeur={
            <Badge variant="secondary">
              {LIBELLES_TYPE_CLIENT[client.typeClient]}
            </Badge>
          }
        />
        <Champ libelle="Téléphone" valeur={client.phone} />
        <Champ libelle="E-mail" valeur={client.email} />
        <Champ libelle="CIN" valeur={client.cin} />
        <Champ libelle="Médecin traitant" valeur={client.medecinTraitant} />
      </Section>

      <Section titre="Adresse" icone={<Home className="size-4" />}>
        <Champ libelle="Adresse" valeur={client.adresse} />
        <Champ libelle="Code postal" valeur={client.codePostal} />
        <Champ libelle="Ville" valeur={client.ville} />
        <Champ libelle="Pays" valeur={client.pays} />
      </Section>

      <Section titre="Tiers payant" icone={<ShieldCheck className="size-4" />}>
        <Champ libelle="Organisme" valeur={organismeNom} />
        <Champ
          libelle="N° d'immatriculation"
          valeur={client.numeroImmatriculation}
        />
      </Section>
    </div>
  );
}
