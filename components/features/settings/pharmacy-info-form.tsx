"use client";

import { useActionState } from "react";
import { updatePharmacyInfoAction, type ActionState } from "@/lib/server/pharmacy";
import type { PharmacySettings } from "@/lib/server/pharmacy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: ActionState = {};

export function PharmacyInfoForm({ pharmacy }: { pharmacy: PharmacySettings }) {
  const [state, formAction, pending] = useActionState(updatePharmacyInfoAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
      <div className="flex items-center gap-4">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
          {pharmacy.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, not a local asset
            <img src={pharmacy.logoUrl} alt="Logo de la pharmacie" className="size-full object-cover" />
          ) : (
            <span className="text-xs text-muted-foreground">Aucun logo</span>
          )}
        </div>
        <div className="flex-1 space-y-2">
          <Label htmlFor="logo">Logo</Label>
          <Input id="logo" name="logo" type="file" accept="image/*" />
        </div>
      </div>

      {/* Trois colonnes sur très large écran : la carte occupe désormais
          toute la largeur, et à deux colonnes un champ « Téléphone »
          s'étirerait sur sept cents pixels pour dix chiffres. */}
      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
        <div className="space-y-2 sm:col-span-2 2xl:col-span-3">
          <Label htmlFor="name">Nom de la pharmacie</Label>
          <Input id="name" name="name" defaultValue={pharmacy.name} required />
        </div>
        <div className="space-y-2 sm:col-span-2 2xl:col-span-3">
          <Label htmlFor="address">Adresse</Label>
          <Input id="address" name="address" defaultValue={pharmacy.address ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Téléphone</Label>
          <Input id="phone" name="phone" type="tel" defaultValue={pharmacy.phone ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ice">ICE</Label>
          <Input id="ice" name="ice" defaultValue={pharmacy.ice ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="orderNumber">Numéro d&apos;ordre</Label>
          <Input id="orderNumber" name="orderNumber" defaultValue={pharmacy.orderNumber ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="inpe">Identifiant INPE</Label>
          <Input id="inpe" name="inpe" defaultValue={pharmacy.inpe ?? ""} />
          <p className="text-xs text-muted-foreground">
            Identifiant National du Praticien et de l&apos;Établissement — il figure sur les
            bordereaux adressés aux organismes de tiers payant.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="loyaltyRate">Taux de fidélité</Label>
          <Input
            id="loyaltyRate"
            name="loyaltyRate"
            type="number"
            min={0}
            step="0.01"
            defaultValue={pharmacy.loyaltyRate}
          />
          <p className="text-xs text-muted-foreground">
            Dirhams dépensés pour 1 point. Ex. 1 = 1 DH donne 1 point ; 10 = 10 DH donnent 1
            point. Mettre 0 désactive le programme.
          </p>
        </div>
      </div>

      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.success && (
        <Alert>
          <AlertDescription>Informations enregistrées.</AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Enregistrement..." : "Enregistrer"}
      </Button>
    </form>
  );
}
