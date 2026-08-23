import { getEtatCaisse, getResumeSession, peutCloturer } from "@/lib/server/caisse";
import { PosView } from "@/components/features/pos/pos-view";

export default async function PosPage() {
  const [etatCaisse, resume, cloture] = await Promise.all([
    getEtatCaisse(),
    getResumeSession(),
    peutCloturer(),
  ]);

  // Le comptoir est toujours rendu : quand la caisse est fermée, il reste
  // visible derrière la fenêtre d'ouverture, flouté et inerte.
  return <PosView etatCaisse={etatCaisse} resume={resume} cloture={cloture} />;
}
