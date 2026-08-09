import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().email("Adresse e-mail invalide"),
  password: z.string().min(8, "8 caractères minimum"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const signUpSchema = z.object({
  pharmacyName: z.string().trim().min(1, "Nom de la pharmacie requis"),
  email: z.string().trim().email("Adresse e-mail invalide"),
  password: z.string().min(8, "8 caractères minimum"),
});

export type SignUpInput = z.infer<typeof signUpSchema>;

export const inviteAssistantSchema = z.object({
  name: z.string().trim().min(1, "Nom requis"),
  email: z.string().trim().email("Adresse e-mail invalide"),
});

export type InviteAssistantInput = z.infer<typeof inviteAssistantSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Adresse e-mail invalide"),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const setPasswordSchema = z
  .object({
    password: z.string().min(8, "8 caractères minimum"),
    confirmPassword: z.string().min(8, "8 caractères minimum"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Les mots de passe ne correspondent pas",
    path: ["confirmPassword"],
  });

export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
