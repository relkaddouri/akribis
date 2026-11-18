"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Field wrappers for the catalogue form. Section 5.1 of the PRD lists
 * about forty fields; without these the three step components would be a
 * thousand lines of repeated label/input/error markup.
 */

export function Field({
  id,
  label,
  hint,
  error,
  wide,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "space-y-2 sm:col-span-2" : "space-y-2"}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  wide,
  required,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  wide?: boolean;
  required?: boolean;
  inputMode?: "text" | "numeric" | "decimal";
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error} wide={wide}>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        required={required}
        inputMode={inputMode}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function TextAreaField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  rows = 3,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  rows?: number;
}) {
  return (
    <Field id={id} label={label} hint={hint} wide>
      <Textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function SelectField<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  hint,
  error,
  wide,
}: {
  id: string;
  label: string;
  value: T | "";
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  placeholder?: string;
  hint?: string;
  error?: string;
  wide?: boolean;
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error} wide={wide}>
      <Select value={value || undefined} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder ?? "Sélectionner"} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function SwitchField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-sp-md rounded-lg bg-muted/50 px-sp-md py-sp-sm sm:col-span-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="pt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase sm:col-span-2">
      {children}
    </p>
  );
}
