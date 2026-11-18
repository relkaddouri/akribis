"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { updateClient, type ClientRecord } from "@/lib/server/clients";
import type { OrganismeRecord } from "@/lib/server/organismes";
import {
  clientEditSchema,
  LIBELLES_TYPE_CLIENT,
  TYPES_CLIENT,
  type ClientEditInput,
} from "@/lib/validations/clients";
import { useDashboardUser } from "@/components/providers/dashboard-user-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * L'édition de la fiche client — le seul endroit où se saisissent le CIN,
 * l'adresse, l'affiliation et le plafond.
 *
 * Le formulaire d'ajout rapide reste à deux champs et ne bouge pas : il
 * s'ouvre en pleine vente, avec un client qui attend au comptoir. Ce
 * dialogue-ci se remplit après coup, à tête reposée, d'où les sections
 * plutôt qu'une colonne de quinze champs.
 */

const AUCUN_ORGANISME = "__aucun__";

function Section({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-sp-sm">
      <legend className="mb-sp-xs text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {titre}
      </legend>
      <div className="grid gap-sp-sm sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Champ({
  id,
  libelle,
  children,
  pleineLargeur = false,
}: {
  id: string;
  libelle: string;
  children: ReactNode;
  pleineLargeur?: boolean;
}) {
  return (
    <div className={pleineLargeur ? "space-y-2 sm:col-span-2" : "space-y-2"}>
      <Label htmlFor={id}>{libelle}</Label>
      {children}
    </div>
  );
}

export function ClientEditDialog({
  client,
  organismes,
}: {
  client: ClientRecord;
  organismes: OrganismeRecord[];
}) {
  const router = useRouter();
  const utilisateur = useDashboardUser();
  const [open, setOpen] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // Le plafond engage l'officine : c'est une décision de gestion, pas un
  // renseignement d'état civil. L'assistant remplit la fiche, le
  // titulaire fixe ce qu'il accepte de laisser devoir.
  const peutFixerPlafond = utilisateur.role === "owner";

  // Contrôlés, tous les deux : un `<Select>` Radix ne participe pas au
  // FormData, et une valeur vide ferait retomber le composant en
  // non contrôlé — l'interrupteur du stock l'a déjà appris à ses dépens.
  const [typeClient, setTypeClient] = useState<string>(client.typeClient);
  const [insurerId, setInsurerId] = useState<string>(
    client.insurerId ?? AUCUN_ORGANISME,
  );

  const mutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const texte = (cle: string) => String(formData.get(cle) ?? "");
      const entree: ClientEditInput = {
        name: texte("name"),
        phone: texte("phone"),
        email: texte("email"),
        typeClient: typeClient as ClientEditInput["typeClient"],
        cin: texte("cin"),
        medecinTraitant: texte("medecinTraitant"),
        adresse: texte("adresse"),
        codePostal: texte("codePostal"),
        ville: texte("ville"),
        pays: texte("pays"),
        numeroImmatriculation: texte("numeroImmatriculation"),
        insurerId: insurerId === AUCUN_ORGANISME ? null : insurerId,
        // Le champ n'est pas rendu pour un assistant : reprendre la valeur
        // de la fiche, sinon l'enregistrement l'effacerait sans que
        // personne ne l'ait demandé.
        plafondCredit: peutFixerPlafond
          ? texte("plafondCredit")
          : client.plafondCredit,
      };
      const controle = clientEditSchema.safeParse(entree);
      if (!controle.success) {
        throw new Error(
          controle.error.issues[0]?.message ?? "Formulaire invalide",
        );
      }
      return updateClient(client.id, entree);
    },
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
    onError: (err: Error) => setErreur(err.message),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErreur(null);
    mutation.mutate(new FormData(event.currentTarget));
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil />
        Modifier
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <form onSubmit={handleSubmit} className="space-y-sp-lg">
            <DialogHeader>
              <DialogTitle>Modifier la fiche client</DialogTitle>
              <DialogDescription>
                Le CIN et le médecin traitant sont des données personnelles :
                leur consultation comme leur modification sont journalisées.
              </DialogDescription>
            </DialogHeader>

            <Section titre="Identité">
              <Champ id="name" libelle="Nom">
                <Input
                  id="name"
                  name="name"
                  defaultValue={client.name}
                  required
                />
              </Champ>
              <Champ id="typeClient" libelle="Type de client">
                <Select value={typeClient} onValueChange={setTypeClient}>
                  <SelectTrigger id="typeClient" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES_CLIENT.map((valeur) => (
                      <SelectItem key={valeur} value={valeur}>
                        {LIBELLES_TYPE_CLIENT[valeur]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Champ>
              <Champ id="phone" libelle="Téléphone">
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  defaultValue={client.phone ?? ""}
                />
              </Champ>
              <Champ id="email" libelle="E-mail">
                <Input
                  id="email"
                  name="email"
                  type="email"
                  defaultValue={client.email ?? ""}
                />
              </Champ>
              <Champ id="cin" libelle="CIN">
                <Input id="cin" name="cin" defaultValue={client.cin ?? ""} />
              </Champ>
              <Champ id="medecinTraitant" libelle="Médecin traitant">
                <Input
                  id="medecinTraitant"
                  name="medecinTraitant"
                  defaultValue={client.medecinTraitant ?? ""}
                />
              </Champ>
            </Section>

            <Section titre="Adresse">
              <Champ id="adresse" libelle="Adresse" pleineLargeur>
                <Input
                  id="adresse"
                  name="adresse"
                  defaultValue={client.adresse ?? ""}
                />
              </Champ>
              <Champ id="codePostal" libelle="Code postal">
                <Input
                  id="codePostal"
                  name="codePostal"
                  defaultValue={client.codePostal ?? ""}
                />
              </Champ>
              <Champ id="ville" libelle="Ville">
                <Input
                  id="ville"
                  name="ville"
                  defaultValue={client.ville ?? ""}
                />
              </Champ>
              <Champ id="pays" libelle="Pays">
                <Input
                  id="pays"
                  name="pays"
                  defaultValue={client.pays ?? "Maroc"}
                />
              </Champ>
            </Section>

            <Section titre="Tiers payant">
              <Champ id="insurerId" libelle="Organisme d'affiliation">
                <Select value={insurerId} onValueChange={setInsurerId}>
                  <SelectTrigger id="insurerId" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUCUN_ORGANISME}>— Aucun —</SelectItem>
                    {organismes.map((organisme) => (
                      <SelectItem key={organisme.id} value={organisme.id}>
                        {organisme.nom}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Champ>
              <Champ id="numeroImmatriculation" libelle="N° d'immatriculation">
                <Input
                  id="numeroImmatriculation"
                  name="numeroImmatriculation"
                  defaultValue={client.numeroImmatriculation ?? ""}
                />
              </Champ>
            </Section>

            <Section titre="Crédit">
              {peutFixerPlafond ? (
                <Champ
                  id="plafondCredit"
                  libelle="Plafond de crédit (MAD)"
                  pleineLargeur
                >
                  <Input
                    id="plafondCredit"
                    name="plafondCredit"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Aucun plafond"
                    defaultValue={client.plafondCredit ?? ""}
                    className="tabular-nums"
                  />
                  <p className="text-xs text-muted-foreground">
                    Laisser vide pour ne fixer aucune limite. Le dépassement
                    avertit le pharmacien en caisse, il ne bloque pas la vente.
                  </p>
                </Champ>
              ) : (
                <p className="text-sm text-muted-foreground sm:col-span-2">
                  Seul le titulaire fixe le plafond de crédit.
                </p>
              )}
            </Section>

            {erreur && (
              <Alert variant="destructive">
                <AlertDescription>{erreur}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Enregistrement..." : "Enregistrer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
