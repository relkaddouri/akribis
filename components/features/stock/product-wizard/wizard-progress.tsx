"use client";

import { cn } from "@/lib/utils";
import { WIZARD_STEPS } from "./types";

export function WizardProgress({
  currentStep,
  maxReachableStep,
  onStepClick,
}: {
  currentStep: number;
  maxReachableStep: number;
  onStepClick: (step: number) => void;
}) {
  const percent = (currentStep / WIZARD_STEPS.length) * 100;

  return (
    <div className="space-y-3">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex items-start justify-between">
        {WIZARD_STEPS.map((step) => {
          const reachable = step.id <= maxReachableStep;
          const isCurrent = step.id === currentStep;
          return (
            <button
              key={step.id}
              type="button"
              disabled={!reachable}
              onClick={() => onStepClick(step.id)}
              className="flex flex-col items-center gap-1.5 text-center text-xs disabled:cursor-not-allowed"
            >
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full font-semibold",
                  isCurrent
                    ? "bg-primary text-primary-foreground"
                    : reachable
                      ? "bg-emerald-50 text-primary"
                      : "bg-muted text-muted-foreground/50",
                )}
              >
                {step.id}
              </span>
              <span
                className={cn(
                  "hidden max-w-20 sm:block",
                  reachable ? "text-foreground" : "text-muted-foreground/50",
                )}
              >
                {step.label}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">
        Étape {currentStep} sur {WIZARD_STEPS.length}
      </p>
    </div>
  );
}
