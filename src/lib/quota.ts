/**
 * Two guards that stand between a click and Groq's free tier.
 *
 * The first is a token ledger. Groq meters this account at 8,000 tokens a
 * minute and charges prompt + max_tokens against it up front, so one full
 * four-agent investigation costs 6,000-8,000 of them — very nearly the whole
 * allowance in a single shot. The route used to find this out the expensive way:
 * send the request, read the 429, react. That wastes a round trip and, worse, it
 * cannot tell the person waiting how long they need to wait. Groq actually
 * publishes its own meter on every single response, so the fix is to read it and
 * do the arithmetic ahead of the call instead of behind it.
 *
 * The second is a per-user limiter, because a quota shared by everyone is a
 * quota one person can empty. Three investigations a minute is far more than
 * anyone reviewing a report needs and far less than a stuck mouse button
 * produces.
 *
 * Both keep their state in memory, deliberately, exactly like the report cache
 * in the chat route. See the note above `checkRate` for what that costs on
 * serverless and why it is still the right call here.
 */

// Groq meters per *bucket*, not per model id, and that distinction decides
// whether walking the model chain buys any headroom. Measured on this account:
// gpt-oss-120b and gpt-oss-20b both reported 7,927 tokens remaining at the same
// instant, which means they draw down one shared 8,000 allowance and falling
// through from one to the other gains nothing. groq/compound is metered
// separately and genuinely does.
export type Bucket = "gpt-oss" | "compound" | "other";

export const bucketOf = (model: string): Bucket =>
  model.startsWith("openai/gpt-oss")
    ? "gpt-oss"
    : model.startsWith("groq/compound")
      ? "compound"
      : "other";

// Sensible starting points for a bucket nobody has called yet. The moment a real
// response arrives these are replaced by Groq's own figures, so being slightly
// wrong here costs at most one over-optimistic request.
const ASSUMED_LIMIT: Record<Bucket, number> = {
  "gpt-oss": 8_000,
  compound: 12_000,
  other: 6_000,
};

type Ledger = {
  /** Tokens left at the moment `syncedAt` was taken. */
  remaining: number;
  limit: number;
  syncedAt: number;
};

const ledgers = new Map<Bucket, Ledger>();

const ledgerFor = (bucket: Bucket): Ledger => {
  let l = ledgers.get(bucket);
  if (!l) {
    l = { remaining: ASSUMED_LIMIT[bucket], limit: ASSUMED_LIMIT[bucket], syncedAt: Date.now() };
    ledgers.set(bucket, l);
  }
  return l;
};

/**
 * Groq's reset headers are human-readable rather than numeric: "547ms",
 * "1m26.4s", "5m45.6s" have all come back from this account. Parsed here only
 * for logging and for the rare case where it is the sole signal available — the
 * refill rate below is derived from the limit, not from this.
 */
export function parseResetMs(value: string | null): number | null {
  if (!value) return null;
  const ms = /^([\d.]+)ms$/.exec(value.trim());
  if (ms) return Number(ms[1]);
  const parts = /^(?:([\d.]+)m)?(?:([\d.]+)s)?$/.exec(value.trim());
  if (!parts || (!parts[1] && !parts[2])) return null;
  return (Number(parts[1] ?? 0) * 60 + Number(parts[2] ?? 0)) * 1000;
}

/**
 * The bucket refills continuously, and the arithmetic checks out against the
 * live API: after a call that spent 73 tokens the reset header read "547ms",
 * and 73 tokens at 8,000/minute is 547.5ms of refill. A fixed one-minute window
 * would have reported something close to 60s instead. So tokens come back at
 * limit/60000 per millisecond, smoothly, and a request only has to wait for the
 * shortfall rather than for a window boundary.
 */
function projected(l: Ledger, now: number): number {
  const refilled = l.remaining + ((now - l.syncedAt) * l.limit) / 60_000;
  return Math.min(l.limit, Math.max(0, refilled));
}

/**
 * Overwrite a bucket's ledger with Groq's own numbers. This is the call that
 * makes every other function here honest: without it the ledger is an estimate
 * built on a four-characters-per-token guess, and with it the estimate only has
 * to survive until the next response arrives.
 *
 * It also quietly fixes the multi-instance problem. Each serverless instance
 * keeps its own ledger and therefore starts out believing it owns the whole
 * allowance — but the remaining count Groq reports is account-wide, so the first
 * real response any instance sees corrects it to the truth. The drift costs one
 * over-optimistic call per cold instance, not a drained quota.
 */
export function syncFromHeaders(model: string, headers: Headers): void {
  const remaining = Number(headers.get("x-ratelimit-remaining-tokens"));
  if (!Number.isFinite(remaining)) return;

  const bucket = bucketOf(model);
  const l = ledgerFor(bucket);
  const limit = Number(headers.get("x-ratelimit-limit-tokens"));
  if (Number.isFinite(limit) && limit > 0) l.limit = limit;
  l.remaining = Math.max(0, remaining);
  l.syncedAt = Date.now();
}

/**
 * Milliseconds until `model` can afford a `needed`-token request; 0 if it can
 * right now. The caller decides whether that wait is worth absorbing or worth
 * reporting — a two-second hold is invisible, a forty-second one needs saying
 * out loud.
 */
export function waitFor(model: string, needed: number): number {
  const l = ledgerFor(bucketOf(model));
  // A request larger than the bucket's entire allowance can never fit, no matter
  // how long anyone waits. Report the full-refill time and let the caller treat
  // it as the long wait it is, rather than returning Infinity and forcing every
  // call site to special-case it.
  if (needed > l.limit) return 60_000;

  const short = needed - projected(l, Date.now());
  if (short <= 0) return 0;
  return Math.ceil((short * 60_000) / l.limit);
}

/**
 * Debit before the call rather than after it. Two requests arriving together in
 * one instance would otherwise both read the same healthy ledger, both decide
 * they have room, and both spend it — the exact double-spend the governor exists
 * to prevent. The real figure arrives with the response and replaces this.
 */
export function reserve(model: string, needed: number): void {
  const l = ledgerFor(bucketOf(model));
  l.remaining = Math.max(0, projected(l, Date.now()) - needed);
  l.syncedAt = Date.now();
}

/** Hand back a reservation for a call that never reached Groq at all. */
export function release(model: string, needed: number): void {
  const l = ledgerFor(bucketOf(model));
  l.remaining = Math.min(l.limit, projected(l, Date.now()) + needed);
  l.syncedAt = Date.now();
}

/** Read-only view of a bucket, for logging and for the QA harness. */
export function ledgerSnapshot(model: string) {
  const bucket = bucketOf(model);
  const l = ledgerFor(bucket);
  return { bucket, limit: l.limit, projected: Math.round(projected(l, Date.now())) };
}

// ---------------------------------------------------------------------------
// Per-user rate limiting
// ---------------------------------------------------------------------------

// An investigation is the expensive call and the one worth clicking twice by
// accident, so it gets the tight number. Chat is cheap enough that the limit is
// really only there to stop a script. The global ceiling is the backstop: it
// bounds what every user together can draw out of one shared free tier, which
// is the number that actually decides whether the app still works while someone
// is watching it.
export const LIMITS = {
  investigatePerMin: 3,
  casualPerMin: 12,
  globalPerMin: 25,
} as const;

const WINDOW_MS = 60_000;

// Left in memory on purpose. Firestore-backed counters would survive across
// serverless instances, but they would also add a read and a write to every
// single turn — spending Firebase quota to protect Groq quota, and adding
// latency to the request the user is waiting on. At this scale a warm instance
// serves a whole session, so per-instance counters are accurate in practice and
// free. The token ledger above is what genuinely protects the allowance; this is
// fairness between users, and it is allowed to be approximate.
type Window = { investigate: number[]; casual: number[] };
const perUser = new Map<string, Window>();
const globalHits: number[] = [];

// One entry per identity, so an open endpoint plus a script equals unbounded
// growth. Oldest-first eviction keeps it to a few hundred, which is far more
// than a demo needs and small enough to never matter.
const MAX_TRACKED_USERS = 500;

const prune = (hits: number[], now: number) => {
  while (hits.length && now - hits[0] >= WINDOW_MS) hits.shift();
  return hits;
};

export type RateVerdict =
  | { ok: true }
  | { ok: false; retryAfterMs: number; scope: "user" | "global" };

/**
 * A sliding window rather than a fixed one, because a fixed window lets someone
 * spend a whole minute's allowance in the last second of one window and again in
 * the first second of the next. `retryAfterMs` is when the oldest hit in the
 * window falls out of it — the real moment a slot opens, not a round number.
 *
 * Only counts calls that will actually reach Groq. A cached report costs
 * nothing, so the caller checks its cache first and never gets here on a hit.
 */
export function checkRate(id: string, kind: "investigate" | "casual"): RateVerdict {
  const now = Date.now();

  prune(globalHits, now);
  if (globalHits.length >= LIMITS.globalPerMin) {
    return { ok: false, retryAfterMs: WINDOW_MS - (now - globalHits[0]), scope: "global" };
  }

  let w = perUser.get(id);
  if (!w) {
    if (perUser.size >= MAX_TRACKED_USERS) {
      const oldest = perUser.keys().next().value;
      if (oldest !== undefined) perUser.delete(oldest);
    }
    w = { investigate: [], casual: [] };
  } else {
    // Re-inserted below, so the Map's insertion order stays least-recently-used
    // first and the eviction above removes the right entry.
    perUser.delete(id);
  }
  perUser.set(id, w);

  const hits = prune(kind === "investigate" ? w.investigate : w.casual, now);
  const cap = kind === "investigate" ? LIMITS.investigatePerMin : LIMITS.casualPerMin;
  if (hits.length >= cap) {
    return { ok: false, retryAfterMs: WINDOW_MS - (now - hits[0]), scope: "user" };
  }

  hits.push(now);
  globalHits.push(now);
  return { ok: true };
}

/**
 * Give a slot back when the call it was taken for never happened — a governor
 * hold that turned into a local report, say. Without this, a refusal would cost
 * the user the same allowance as an answer.
 */
export function refund(id: string, kind: "investigate" | "casual"): void {
  const w = perUser.get(id);
  if (w) (kind === "investigate" ? w.investigate : w.casual).pop();
  globalHits.pop();
}

/** Whole seconds, rounded up, and never zero — "wait 0 seconds" is not advice. */
export const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));
