const FAILURES_BEFORE_LOCK = 8;
const LOCK_MS = 15 * 60 * 1000;

type Bucket = { failures: number; lockedUntil: number };

export function createPairingThrottle(now: () => number = () => Date.now()) {
  const buckets = new Map<string, Bucket>();

  function bucketFor(key: string) {
    const current = buckets.get(key);
    if (!current) {
      return { failures: 0, lockedUntil: 0 };
    }
    if (current.lockedUntil && now() >= current.lockedUntil) {
      return { failures: 0, lockedUntil: 0 };
    }
    return current;
  }

  return {
    status(key: string) {
      const bucket = bucketFor(key);
      if (bucket.lockedUntil > now()) {
        return {
          ok: false as const,
          retryAfterSeconds: Math.ceil((bucket.lockedUntil - now()) / 1000),
        };
      }
      return { ok: true as const };
    },
    recordFailure(key: string) {
      const bucket = bucketFor(key);
      bucket.failures += 1;
      if (bucket.failures >= FAILURES_BEFORE_LOCK) {
        bucket.failures = 0;
        bucket.lockedUntil = now() + LOCK_MS;
      }
      buckets.set(key, bucket);
      return bucket.lockedUntil > now();
    },
    recordSuccess(key: string) {
      buckets.delete(key);
    },
  };
}

export const pairingAttempts = createPairingThrottle();
