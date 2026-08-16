/**
 * Grants — or revokes — the `admin_akribis` role.
 *
 *   npm run admin:promote -- rachid@akribis.ma
 *   npm run admin:promote -- rachid@akribis.ma --invite
 *   npm run admin:promote -- rachid@akribis.ma --revoke
 *
 * The role lives in Supabase `app_metadata`, writable only with the
 * service-role key — which is exactly why this is a script run by a human
 * with the key at hand, and not a page in the app. There is no
 * "make me an admin" button anywhere, on purpose: the first admin has to
 * come from outside the application.
 *
 * This script never sets or reads a password. `--invite` sends Supabase's
 * own invitation e-mail and the person chooses their own password through
 * it.
 *
 * An admin gets no `pharmacy_id` and no row in `public.users` — see the
 * note in lib/auth/roles.ts for why.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const ADMIN_ROLE = "admin_akribis";

function usage(message: string): never {
  console.error(`\n${message}\n`);
  console.error("Usage :");
  console.error("  npm run admin:promote -- <email> [--invite] [--revoke]\n");
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const email = args.find((arg) => !arg.startsWith("--"));
  const invite = args.includes("--invite");
  const revoke = args.includes("--revoke");

  if (!email) usage("Adresse e-mail manquante.");
  if (invite && revoke) usage("--invite et --revoke ne vont pas ensemble.");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

  if (!url || !serviceKey) {
    usage(
      "NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis — vérifiez votre .env.",
    );
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Projet Supabase : ${new URL(url).host}`);

  let userId: string | undefined;

  if (invite) {
    // Without an explicit redirect, Supabase falls back to the project's
    // Site URL — the invitation link then lands on the app's home page
    // carrying a `code` nothing exchanges, and the invitee is stuck with
    // an account they cannot open. Better to refuse than to send a dead
    // link that can only be used once.
    const origin = process.env.APP_ORIGIN;
    if (!origin) {
      usage(
        "APP_ORIGIN est requis avec --invite (ex. APP_ORIGIN=http://localhost:3000).\n" +
          "  Le lien d'invitation doit pointer vers <origine>/auth/callback, et cette URL\n" +
          "  doit figurer dans « Redirect URLs » des réglages Auth de Supabase.",
      );
    }
    const redirectTo = `${origin}/auth/callback?next=/set-password`;
    console.log(`Lien de retour : ${redirectTo}`);
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (error || !data.user) {
      usage(`Invitation impossible : ${error?.message ?? "aucun utilisateur renvoyé"}`);
    }
    userId = data.user.id;
    console.log(`Invitation envoyée à ${email}.`);
  } else {
    // listUsers is paginated; an Akribis team is small, but paging keeps
    // this correct if the project also holds every pharmacist's account.
    for (let page = 1; page <= 50 && !userId; page += 1) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) usage(`Lecture des comptes impossible : ${error.message}`);
      if (data.users.length === 0) break;
      userId = data.users.find(
        (user) => user.email?.toLowerCase() === email.toLowerCase(),
      )?.id;
    }
    if (!userId) {
      usage(`Aucun compte pour ${email}. Ajoutez --invite pour l'inviter.`);
    }
  }

  const { error } = await supabase.auth.admin.updateUserById(userId, {
    // Replaces the whole app_metadata: an admin must not keep a stale
    // pharmacy_id from a previous life as a pharmacist, or the pharmacy
    // guards would see a role/pharmacy pair that shouldn't exist.
    app_metadata: revoke ? { role: null, pharmacy_id: null } : { role: ADMIN_ROLE },
  });
  if (error) usage(`Attribution du rôle impossible : ${error.message}`);

  if (revoke) {
    console.log(`\n✓ Rôle retiré à ${email}. Le compte n'a plus accès à /admin.`);
    console.log("  Il devra se reconnecter pour que le changement prenne effet.\n");
  } else {
    console.log(`\n✓ ${email} a le rôle ${ADMIN_ROLE} et accède à /admin/catalogue.`);
    console.log("  Une session déjà ouverte doit être fermée puis rouverte.\n");
  }
}

main().catch((error) => {
  console.error("\nÉchec :\n", error);
  process.exit(1);
});
