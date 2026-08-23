"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { prisma } from "@/lib/db/client";
import { requireOwner } from "@/lib/auth/session";
import {
  DEFAULT_AUTHENTICATED_PATH,
  LOGIN_PATH,
  RESET_PASSWORD_PATH,
  defaultPathForRole,
} from "@/lib/auth/access-control";
import { getPharmacyIdFromUser, getSessionRoleFromUser } from "@/lib/auth/roles";
import { ENTITES, journaliser, TYPES_ACTION } from "@/lib/audit/event-log";
import { isRateLimited } from "@/lib/auth/rate-limit";
import {
  forgotPasswordSchema,
  inviteAssistantSchema,
  loginSchema,
  setPasswordSchema,
  signUpSchema,
} from "@/lib/validations/auth";

export type ActionState = { error?: string; success?: boolean };

/**
 * Journalise un événement de compte sans jamais faire échouer l'action.
 *
 * Une connexion refusée parce que le journal était indisponible mettrait
 * l'officine à l'arrêt pour une écriture accessoire. Sur les actions
 * métier la trace est dans la transaction, et l'échec des deux ensemble
 * est le comportement voulu ; ici l'authentification passe par Supabase
 * et non par Prisma, il n'y a pas de transaction commune à partager. Le
 * choix est donc explicite : la trace cède le pas à l'accès.
 */
async function journaliserCompte(entree: {
  typeAction: (typeof TYPES_ACTION)[keyof typeof TYPES_ACTION];
  acteur: { id: string; email: string; role: string };
  pharmacyId: string | null;
  cible?: string;
  apres?: unknown;
}): Promise<void> {
  try {
    await journaliser(prisma, {
      acteur: entree.acteur,
      typeAction: entree.typeAction,
      entite: ENTITES.utilisateur,
      entiteId: entree.cible ?? entree.acteur.id,
      pharmacyId: entree.pharmacyId,
      apres: entree.apres,
    });
  } catch {
    // Silencieux à dessein — voir ci-dessus.
  }
}

async function getAppOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const protocol = h.get("x-forwarded-proto") ?? "https";
  return `${protocol}://${host}`;
}

export async function signInAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Signing in always needs a live round trip to Supabase — it can't
    // be served from the offline cache. Without this check, a dropped
    // connection would show "Identifiants incorrects" and read like a
    // wrong password, when the real cause is no network at all.
    if (isAuthRetryableFetchError(error)) {
      return { error: "Connexion au serveur impossible. Vérifiez votre connexion internet." };
    }
    return { error: "Identifiants incorrects" };
  }

  const role = getSessionRoleFromUser(data.user);
  // Avant le `redirect()`, qui lève : rien ne s'exécute après lui.
  await journaliserCompte({
    typeAction: TYPES_ACTION.utilisateurConnexion,
    acteur: { id: data.user.id, email: data.user.email ?? parsed.data.email, role: role ?? "?" },
    pharmacyId: getPharmacyIdFromUser(data.user),
  });

  // Akribis staff have no pharmacy dashboard. The middleware would bounce
  // them anyway, but sending them straight to the back-office spares a
  // visible redirect through a page they can never see.
  redirect(defaultPathForRole(role));
}

/**
 * Creates the very first owner account for a new pharmacy: a `pharmacies`
 * row, a Supabase Auth account, and the matching `public.users` profile
 * row. These are three separate systems (Postgres via Prisma, Supabase
 * Auth's admin API) with no shared transaction, so "succeed or fail
 * together" is implemented as a saga: each step's id is tracked as it
 * completes, and any failure triggers a best-effort compensating rollback
 * of everything created so far, in reverse order.
 */
export async function signUpOwnerAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signUpSchema.safeParse({
    pharmacyName: formData.get("pharmacyName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide" };
  }
  const { pharmacyName, email, password } = parsed.data;

  const admin = createAdminClient();
  let pharmacyId: string | null = null;
  let authUserId: string | null = null;

  try {
    const pharmacy = await prisma.pharmacy.create({ data: { name: pharmacyName } });
    pharmacyId = pharmacy.id;

    const { data, error: createUserError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createUserError || !data.user) {
      throw new Error("Impossible de créer le compte (adresse déjà utilisée ?)");
    }
    authUserId = data.user.id;

    const { error: metadataError } = await admin.auth.admin.updateUserById(authUserId, {
      app_metadata: { role: "owner", pharmacy_id: pharmacyId },
    });
    if (metadataError) {
      throw new Error("Impossible d'attribuer le rôle titulaire");
    }

    await prisma.user.create({
      data: {
        id: authUserId,
        pharmacyId,
        // No dedicated "owner name" field on the signup form; using the
        // email's local part as a placeholder display name for now.
        name: email.split("@")[0],
        email,
        role: "OWNER",
      },
    });
  } catch (err) {
    if (authUserId) {
      await admin.auth.admin.deleteUser(authUserId).catch(() => {});
    }
    if (pharmacyId) {
      await prisma.pharmacy.delete({ where: { id: pharmacyId } }).catch(() => {});
    }
    return {
      error: err instanceof Error ? err.message : "Erreur lors de l'inscription",
    };
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    // Account exists and is usable — just couldn't auto sign-in (e.g.
    // transient error). Send them to log in manually instead of failing
    // the whole signup at this point. `redirect()` never returns.
    redirect(LOGIN_PATH);
  }

  redirect(DEFAULT_AUTHENTICATED_PATH);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  // Lu AVANT la déconnexion : après, la session n'existe plus et le
  // journal ne saurait plus qui vient de partir.
  const { data } = await supabase.auth.getUser();

  await supabase.auth.signOut();

  if (data.user) {
    await journaliserCompte({
      typeAction: TYPES_ACTION.utilisateurDeconnexion,
      acteur: {
        id: data.user.id,
        email: data.user.email ?? "",
        role: getSessionRoleFromUser(data.user) ?? "?",
      },
      pharmacyId: getPharmacyIdFromUser(data.user),
    });
  }

  redirect(LOGIN_PATH);
}

/**
 * Only the owner can invite an assistant, and only into their own
 * pharmacy. `requireOwner()` re-checks this server-side — the pharmacy id
 * always comes from the caller's own session, never from form input, so
 * a tampered request can't invite someone into a different tenant.
 */
export async function inviteAssistantAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owner = await requireOwner();

  const parsed = inviteAssistantSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide" };
  }

  const origin = await getAppOrigin();
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
    data: { name: parsed.data.name },
    redirectTo: `${origin}/auth/callback?next=/set-password`,
  });

  if (error || !data.user) {
    return { error: "Impossible d'inviter cet assistant (e-mail déjà utilisé ?)" };
  }

  const { error: metadataError } = await admin.auth.admin.updateUserById(data.user.id, {
    app_metadata: { role: "assistant", pharmacy_id: owner.pharmacyId },
  });
  if (metadataError) {
    return { error: "Impossible d'attribuer le rôle assistant" };
  }

  await prisma.user.create({
    data: {
      id: data.user.id,
      pharmacyId: owner.pharmacyId,
      name: parsed.data.name,
      email: parsed.data.email,
      role: "ASSISTANT",
    },
  });

  // L'invitation crée un accès à des données personnelles : c'est le
  // titulaire qui l'accorde, et le journal retient à qui.
  await journaliserCompte({
    typeAction: TYPES_ACTION.utilisateurInvite,
    acteur: { id: owner.id, email: owner.email, role: owner.role },
    pharmacyId: owner.pharmacyId,
    // La cible est l'invité, pas celui qui invite.
    cible: data.user.id,
    apres: { nom: parsed.data.name, email: parsed.data.email, role: "assistant" },
  });

  revalidatePath("/parametres");
  return { success: true };
}

export async function setPasswordAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = setPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: "Impossible de définir le mot de passe" };
  }

  redirect(DEFAULT_AUTHENTICATED_PATH);
}

async function getClientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * Always returns the same { success: true } shape — whether the address
 * is registered, malformed-but-plausible, or currently rate-limited —
 * so nothing about the response lets a caller enumerate real accounts.
 * Only a genuinely invalid email *format* gets a distinct error, which
 * reveals nothing about who has an account.
 */
export async function forgotPasswordAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide" };
  }

  const email = parsed.data.email;
  const ip = await getClientIp();
  const limited =
    isRateLimited(`forgot-password:email:${email.toLowerCase()}`) ||
    isRateLimited(`forgot-password:ip:${ip}`);

  if (!limited) {
    const origin = await getAppOrigin();
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=${RESET_PASSWORD_PATH}`,
    });
    // Result intentionally ignored — see the doc comment above.
  }

  return { success: true };
}

export async function resetPasswordAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = setPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: "Impossible de réinitialiser le mot de passe. Réessayez ou demandez un nouveau lien." };
  }

  // The recovery code exchange left an active session behind — sign it
  // out explicitly so the user has to log back in with their new
  // password rather than being silently left signed in.
  await supabase.auth.signOut();
  redirect(`${LOGIN_PATH}?reset=success`);
}
