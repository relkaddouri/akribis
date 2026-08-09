"use client";

import { PRODUCT_CATEGORIES } from "@/lib/validations/products";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PhotoUploadField } from "./photo-upload-field";
import type { WizardState } from "./types";

export function StepGeneralInfo({
  state,
  errors,
  onChange,
}: {
  state: WizardState;
  errors: Record<string, string>;
  onChange: <K extends keyof WizardState>(field: K, value: WizardState[K]) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Photo</Label>
        <PhotoUploadField value={state.photoUrl} onChange={(url) => onChange("photoUrl", url)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="name">Nom</Label>
          <Input id="name" value={state.name} onChange={(e) => onChange("name", e.target.value)} required />
          {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="form">Forme</Label>
          <Input
            id="form"
            placeholder="Comprimé, sirop..."
            value={state.form}
            onChange={(e) => onChange("form", e.target.value)}
            required
          />
          {errors.form && <p className="text-sm text-destructive">{errors.form}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="dosage">Dosage</Label>
          <Input
            id="dosage"
            placeholder="500mg"
            value={state.dosage}
            onChange={(e) => onChange("dosage", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="laboratory">Laboratoire</Label>
          <Input
            id="laboratory"
            value={state.laboratory}
            onChange={(e) => onChange("laboratory", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="barcode">Code-barres</Label>
          <Input id="barcode" value={state.barcode} onChange={(e) => onChange("barcode", e.target.value)} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="dci">DCI</Label>
          <Input
            id="dci"
            placeholder="Dénomination commune internationale"
            value={state.dci}
            onChange={(e) => onChange("dci", e.target.value)}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="category">Catégorie</Label>
          <Select
            value={state.category || undefined}
            onValueChange={(value) => onChange("category", value as WizardState["category"])}
          >
            <SelectTrigger id="category" className="w-full">
              <SelectValue placeholder="Sélectionner une catégorie" />
            </SelectTrigger>
            <SelectContent>
              {PRODUCT_CATEGORIES.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
