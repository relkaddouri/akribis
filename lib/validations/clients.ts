import { z } from "zod";

export const clientFormSchema = z.object({
  name: z.string().trim().min(1, "Nom requis"),
  phone: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : null)),
});

export type ClientFormInput = z.input<typeof clientFormSchema>;
export type ClientFormValues = z.output<typeof clientFormSchema>;
