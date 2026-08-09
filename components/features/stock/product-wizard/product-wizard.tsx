"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { createProduct, updateProduct } from "@/lib/offline/products";
import {
  productFormSchema,
  productStep1Schema,
  productStep2Schema,
  productStep3Schema,
  productStep4Schema,
} from "@/lib/validations/products";
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
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { WizardProgress } from "./wizard-progress";
import { StepGeneralInfo } from "./step-general-info";
import { StepPricing } from "./step-pricing";
import { StepReimbursement } from "./step-reimbursement";
import { StepPosology } from "./step-posology";
import {
  EMPTY_WIZARD_STATE,
  FIELD_STEP,
  WIZARD_STEPS,
  productToWizardState,
  type ProductLike,
  type WizardState,
} from "./types";

const STOCK_PATH = "/dashboard/stock";

const STEP_SCHEMAS = [productStep1Schema, productStep2Schema, productStep3Schema, productStep4Schema];

function errorsFromIssues(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0]);
    if (!(key in next)) next[key] = issue.message;
  }
  return next;
}

export function ProductWizard({
  mode,
  product,
}: {
  mode: "create" | "edit";
  product?: ProductLike | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = mode === "edit";

  const initialState = useMemo<WizardState>(
    () => (product ? productToWizardState(product) : EMPTY_WIZARD_STATE),
    [product],
  );

  const [state, setState] = useState<WizardState>(initialState);
  const [currentStep, setCurrentStep] = useState(1);
  const [furthestStep, setFurthestStep] = useState(isEditing ? WIZARD_STEPS.length : 1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  const isDirty = useMemo(() => JSON.stringify(state) !== JSON.stringify(initialState), [state, initialState]);

  function setField<K extends keyof WizardState>(field: K, value: WizardState[K]) {
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
    const next = Math.min(currentStep + 1, WIZARD_STEPS.length);
    setFurthestStep((f) => Math.max(f, next));
    setCurrentStep(next);
  }

  function handlePrevious() {
    setErrors({});
    setCurrentStep((step) => Math.max(1, step - 1));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = productFormSchema.safeParse(state);
      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0]!;
        const stepWithError = FIELD_STEP[String(firstIssue.path[0])] ?? 1;
        setCurrentStep(stepWithError);
        setFurthestStep((f) => Math.max(f, stepWithError));
        setErrors(errorsFromIssues(parsed.error.issues));
        throw new Error("Corrigez les champs invalides avant d'enregistrer.");
      }
      return isEditing && product ? updateProduct(product.id, state) : createProduct(state);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      router.push(STOCK_PATH);
    },
    onError: (err: Error) => setSubmitError(err.message),
  });

  function handlePrimaryAction() {
    setSubmitError(null);
    if (currentStep < WIZARD_STEPS.length) {
      handleNext();
      return;
    }
    mutation.mutate();
  }

  function handleCancel() {
    if (isDirty) {
      setCancelDialogOpen(true);
      return;
    }
    router.push(STOCK_PATH);
  }

  const stepProps = { state, errors, onChange: setField };

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title={isEditing ? "Modifier le produit" : "Ajouter un produit"}
        subtitle="Renseignez les informations du produit pour la pharmacie."
        icon={<Package />}
        backHref={isEditing && product ? `/dashboard/stock/produits/${product.id}` : "/dashboard/stock"}
        backLabel={isEditing ? "Fiche produit" : "Stock"}
      />

      <div className="mx-auto w-full max-w-2xl space-y-sp-lg">

      <WizardProgress
        currentStep={currentStep}
        maxReachableStep={isEditing ? WIZARD_STEPS.length : furthestStep}
        onStepClick={setCurrentStep}
      />

      <div className="rounded-xl bg-card p-6 shadow-card">
        {currentStep === 1 && <StepGeneralInfo {...stepProps} />}
        {currentStep === 2 && <StepPricing {...stepProps} />}
        {currentStep === 3 && <StepReimbursement {...stepProps} />}
        {currentStep === 4 && <StepPosology {...stepProps} />}

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
            <Button type="button" variant="outline" onClick={handlePrevious}>
              Précédent
            </Button>
          )}
          <Button type="button" onClick={handlePrimaryAction} disabled={mutation.isPending}>
            {mutation.isPending
              ? "Enregistrement..."
              : currentStep === WIZARD_STEPS.length
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
            <AlertDialogAction onClick={() => router.push(STOCK_PATH)}>Abandonner</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </div>
  );
}
