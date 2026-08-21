import { cn } from "@/lib/utils";
import { daysUntil } from "@/lib/stock/alerts";

/**
 * « dans 8 jours », « périmé depuis 19 j » — le délai avant péremption,
 * teinté selon l'urgence.
 *
 * Partagé par la barre d'alertes et la fiche produit : les deux écrans
 * parlent du même produit, souvent à quelques secondes d'intervalle, et
 * deux formulations pour un même fait donneraient l'impression de deux
 * faits.
 */

/**
 * Trente jours, parce que c'est l'horizon par défaut des alertes et le
 * premier des trois proposés — pas un seuil inventé pour l'occasion.
 *
 * Au-delà, l'ambre : à l'horizon 60 ou 90 jours la liste contient des
 * échéances lointaines, et tout peindre en rouge ferait perdre au rouge
 * ce qu'il signale.
 */
export const PEREMPTION_URGENTE_JOURS = 30;

export function libelleDelai(jours: number): string {
  if (jours < 0) return `périmé depuis ${Math.abs(jours)} j`;
  if (jours === 0) return "périme aujourd'hui";
  if (jours === 1) return "demain";
  return `dans ${jours} jours`;
}

export function DelaiPeremption({
  date,
  /** Injectable pour les tests ; par défaut, maintenant. */
  from,
  className,
}: {
  date: Date | string;
  from?: Date;
  className?: string;
}) {
  const echeance = typeof date === "string" ? new Date(date) : date;
  const jours = daysUntil(echeance, from);
  const urgent = jours <= PEREMPTION_URGENTE_JOURS;

  return (
    <span
      className={cn(
        "text-sm",
        urgent ? "text-destructive" : "text-amber-700 dark:text-amber-300",
        className,
      )}
    >
      {libelleDelai(jours)}
    </span>
  );
}
