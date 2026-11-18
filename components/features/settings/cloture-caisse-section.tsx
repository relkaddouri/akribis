"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { definirClotureAssistant } from "@/lib/server/caisse";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Le réglage qui autorise un assistant à clôturer la caisse.
 *
 * Désactivé par défaut, et l'interrupteur ne suffit pas à l'activer : il
 * faut poser un code PIN dans le même geste. Un réglage activé sans code
 * laisserait l'assistant devant un champ qui refuse tout, sans que rien
 * n'explique pourquoi.
 */
export function ClotureCaisseSection({ autorisee }: { autorisee: boolean }) {
  const router = useRouter();
  const [actif, setActif] = useState(autorisee);
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, startEnvoi] = useTransition();

  function enregistrer(prochainActif: boolean, prochainPin: string) {
    setErreur(null);
    setMessage(null);
    startEnvoi(async () => {
      const r = await definirClotureAssistant({
        autorisee: prochainActif,
        ...(prochainActif ? { pin: prochainPin } : {}),
      });
      if (!r.ok) return setErreur(r.error);
      setActif(prochainActif);
      setPin("");
      setMessage(
        prochainActif
          ? "Code PIN enregistré. Un assistant peut désormais clôturer la caisse."
          : "Clôture réservée au titulaire. Le code PIN a été effacé.",
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-sp-md">
      <div className="flex items-start justify-between gap-sp-md">
        <div className="space-y-1">
          <Label htmlFor="cloture-assistant">
            Autoriser un assistant à clôturer la caisse avec un code PIN
          </Label>
          <p className="max-w-prose text-xs text-muted-foreground">
            La clôture arrête la journée comptable et fige les ventes de la session. Par
            défaut elle vous est réservée. Une session clôturée par un assistant reste
            identifiée comme telle dans l&apos;historique.
          </p>
        </div>
        <Switch
          id="cloture-assistant"
          checked={actif}
          disabled={envoi}
          onCheckedChange={(valeur) => {
            // Désactiver s'applique tout de suite ; activer attend le code,
            // sinon le réglage serait actif sans moyen de s'en servir.
            if (!valeur) return enregistrer(false, "");
            setActif(true);
            setMessage(null);
          }}
        />
      </div>

      {actif && (
        <div className="max-w-xs space-y-sp-xs">
          <Label htmlFor="cloture-pin">
            {autorisee ? "Remplacer le code PIN" : "Code PIN (4 à 6 chiffres)"}
          </Label>
          <Input
            id="cloture-pin"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••"
          />
          <p className="text-xs text-muted-foreground">
            Le code est enregistré haché : il ne pourra pas être relu, seulement remplacé.
          </p>
          <Button size="sm" disabled={envoi || pin === ""} onClick={() => enregistrer(true, pin)}>
            {envoi ? "Enregistrement..." : "Enregistrer le code"}
          </Button>
        </div>
      )}

      {erreur && (
        <Alert variant="destructive">
          <AlertDescription>{erreur}</AlertDescription>
        </Alert>
      )}
      {message && (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
