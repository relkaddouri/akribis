"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookMarked } from "lucide-react";
import {
  CATALOGUE_FIELD_STEP,
  CATALOGUE_STEPS,
  catalogueFormSchema,
  catalogueStep1Schema,
  catalogueStep2Schema,
  catalogueStep3Schema,
} from "@/lib/validations/catalogue";
import { createCatalogueProduit, updateCatalogueProduit } from "@/lib/server/catalogue";
import type { CatalogueProduitRecord } from "@/lib/server/catalogue";
import { ADMIN_CATALOGUE_PATH } from "@/lib/auth/access-control";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WizardProgress } from "@/components/ui/wizard-progress";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { StepIdentification } from "./step-identification";
import { StepPricing } from "./step-pricing";
import { StepDescriptive } from "./step-descriptive";
import {
  EMPTY_CATALOGUE_STATE,
  recordToWizardState,
  toFormInput,
  type CatalogueWizardState,
} from "./types";

const STEP_SCHEMAS = [catalogueStep1Schema, catalogueStep2Schema, catalogueStep3Schema];

function errorsFromIssues(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0]);
    if (!(key in next)) next[key] = issue.message;
  }
  return next;
}

export function CatalogueWizard({
  mode,
  produit,
}: {
  mode: "create" | "edit";
  produit?: CatalogueProduitRecord | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isEditing = mode === "edit";
  // Éditer se fait depuis la fiche : on y revient, plutôt que de renvoyer
  // l'admin en haut d'une liste de 5 900 lignes qu'il faudrait reparcourir.
  const returnPath =
    isEditing && produit ? `${ADMIN_CATALOGUE_PATH}/${produit.id}` : ADMIN_CATALOGUE_PATH;

  const initialState = useMemo<CatalogueWizardState>(
    () => (produit ? recordToWizardState(produit) : EMPTY_CATALOGUE_STATE),
    [produit],
  );

  const [state, setState] = useState<CatalogueWizardState>(initialState);
  const [currentStep, setCurrentStep] = useState(1);
  const [furthestStep, setFurthestStep] = useState(isEditing ? CATALOGUE_STEPS.length : 1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  const isDirty = useMemo(
    () => JSON.stringify(state) !== JSON.stringify(initialState),
    [state, initialState],
  );

  function setField<K extends keyof CatalogueWizardState>(
    field: K,
    value: CatalogueWizardState[K],
  ) {
    setState((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function validateStep(step: number): boolean {
    const result = STEP_SCHEMAS[step - 1]!.safeParse(state);
    if (result.success) {
      setErrors({});
      return true;
    }
    setErrors(errorsFromIssues(result.error.issues));
    return false;
  }

  function handleNext() {
    if (!validateStep(currentStep)) return;
    const next = Math.min(currentStep + 1, CATALOGUE_STEPS.length);
    setFurthestStep((furthest) => Math.max(furthest, next));
    setCurrentStep(next);
  }

  function handleSubmit() {
    const parsed = catalogueFormSchema.safeParse(state);
    if (!parsed.success) {
      // Jump to whichever step owns the first offending field, otherwise
      // the error message would sit on a step the admin can't see.
      const firstIssue = parsed.error.issues[0]!;
      const stepWithError = CATALOGUE_FIELD_STEP[String(firstIssue.path[0])] ?? 1;
      setCurrentStep(stepWithError);
      setFurthestStep((furthest) => Math.max(furthest, stepWithError));
      setErrors(errorsFromIssues(parsed.error.issues));
      setSubmitError("Corrigez les champs invalides avant d'enregistrer.");
      return;
    }

    startTransition(async () => {
      const input = toFormInput(state);
      const result =
        isEditing && produit
          ? await updateCatalogueProduit(produit.id, input)
          : await createCatalogueProduit(input);

      if (!result.ok) {
        setSubmitError(result.error);
        return;
      }
      router.push(returnPath);
      router.refresh();
    });
  }

  function handlePrimaryAction() {
    setSubmitError(null);
    if (currentStep < CATALOGUE_STEPS.length) {
      handleNext();
      return;
    }
    handleSubmit();
  }

  function handleCancel() {
    if (isDirty) {
      setCancelDialogOpen(true);
      return;
    }
    router.push(returnPath);
  }

  const stepProps = { state, errors, onChange: setField };

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title={isEditing ? "Modifier la fiche catalogue" : "Nouvelle fiche catalogue"}
        subtitle={
          isEditing
            ? produit?.nom
            : "Cette fiche sera visible par toutes les pharmacies de la plateforme."
        }
        icon={<BookMarked />}
        space="admin"
        backHref={isEditing && produit ? `${ADMIN_CATALOGUE_PATH}/${produit.id}` : ADMIN_CATALOGUE_PATH}
        backLabel={isEditing ? "Fiche produit" : "Catalogue"}
      />

      <div className="mx-auto w-full max-w-3xl space-y-sp-lg">
        <WizardProgress
          steps={CATALOGUE_STEPS}
          currentStep={currentStep}
          maxReachableStep={isEditing ? CATALOGUE_STEPS.length : furthestStep}
          onStepClick={setCurrentStep}
        />

        <div className="rounded-xl bg-card p-6 shadow-card">
          {currentStep === 1 && <StepIdentification {...stepProps} />}
          {currentStep === 2 && <StepPricing {...stepProps} />}
          {currentStep === 3 && <StepDescriptive {...stepProps} />}

          {submitError && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          )}
        </div>

        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" onClick={handleCancel}>
            Annuler
          </Button>
          <div className="flex gap-2">
            {currentStep > 1 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setErrors({});
                  setCurrentStep((step) => Math.max(1, step - 1));
                }}
              >
                Précédent
              </Button>
            )}
            <Button type="button" onClick={handlePrimaryAction} disabled={pending}>
              {pending
                ? "Enregistrement..."
                : currentStep === CATALOGUE_STEPS.length
                  ? "Enregistrer"
                  : "Suivant"}
            </Button>
          </div>
        </div>

        <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Abandonner les modifications ?</AlertDialogTitle>
              <AlertDialogDescription>
                Les informations saisies n&apos;ont pas été enregistrées et seront perdues.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Continuer la saisie</AlertDialogCancel>
              <AlertDialogAction onClick={() => router.push(returnPath)}>
                Abandonner
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
