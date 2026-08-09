/**
 * Pure decision function for /reinitialiser-mot-de-passe, extracted the
 * same way as resolveAuthRedirect so it's directly testable without
 * rendering the page: a reset link is only usable when the one-time
 * code exchange in /auth/callback succeeded (no error flag) AND it left
 * behind an active recovery session.
 */
export function isResetLinkInvalid(params: { error: string | null | undefined; hasSession: boolean }): boolean {
  return Boolean(params.error) || !params.hasSession;
}
