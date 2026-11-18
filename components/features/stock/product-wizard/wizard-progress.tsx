"use client";

import { WizardProgress as SharedWizardProgress } from "@/components/ui/wizard-progress";
import { WIZARD_STEPS } from "./types";

/**
 * Thin binding of the shared step indicator to this wizard's own steps —
 * the markup itself now lives in components/ui/wizard-progress.tsx, shared
 * with the admin catalogue form.
 */
export function WizardProgress({
  currentStep,
  maxReachableStep,
  onStepClick,
}: {
  currentStep: number;
  maxReachableStep: number;
  onStepClick: (step: number) => void;
}) {
  return (
    <SharedWizardProgress
      steps={WIZARD_STEPS}
      currentStep={currentStep}
      maxReachableStep={maxReachableStep}
      onStepClick={onStepClick}
    />
  );
}
