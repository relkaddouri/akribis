/**
 * Minimal in-memory fixed-window rate limiter. Good enough for a
 * single-instance deployment guarding a low-value target (password
 * reset requests) — no external store needed. State is per-process, so
 * it resets on redeploy; that's an acceptable trade-off here since the
 * goal is just to blunt casual abuse, not provide hard guarantees.
 */

type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();

export const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
export const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Records one attempt for `key` and reports whether it should be
 * blocked. `now` is injectable for deterministic tests.
 */
export function isRateLimited(
  key: string,
  options: { windowMs?: number; max?: number; now?: number } = {},
): boolean {
  const { windowMs = DEFAULT_WINDOW_MS, max = DEFAULT_MAX_ATTEMPTS, now = Date.now() } = options;

  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return false;
  }

  bucket.count += 1;
  return bucket.count > max;
}

/** Test-only: clears all buckets so cases don't leak into each other. */
export function resetRateLimiter(): void {
  buckets.clear();
}
