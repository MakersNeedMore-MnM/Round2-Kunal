import { NextResponse } from "next/server";
import { buildEvidence, evidenceBrief, localReport, type Evidence } from "@/lib/investigation";
import { formatINR, type Severity, type Transaction } from "@/lib/domain";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// Vercel gives a route handler 10 seconds by default, and a four-agent
// investigation legitimately takes longer than that — more still if the first
// model in the chain is rate-limited and the request has to fall through to the
// second. A killed function looks exactly like a broken AI from the user's side,
// so raise the ceiling to the plan's maximum and let the fallback logic decide
// when to give up. 60s is a limit, not a target: a normal reply lands in 2–4.
export const maxDuration = 60;

// Two modes: normal chat for questions and small talk, and the 4-agent panel
// for an actual investigation. Both are grounded in a pre-computed evidence
// brief so the model quotes this user's real numbers instead of generic AML
// theory — that "cold, always-the-same" answer was the symptom of sending it
// nothing but raw rows.

const PLAIN_LANGUAGE_RULES = `HOW TO WRITE — this matters as much as the analysis:
- Write for someone with no banking or compliance background. A student or a shop owner should follow every sentence.
- Explain jargon the moment you use it: "structuring (splitting one big payment into several small ones so the bank never has to report it)".
- ALWAYS quote the real account names, amounts, dates and bank names from the brief. Never write "Account A" or "a large sum".
- Say WHY something is wrong, not just that it is. Compare it to what normal activity would look like.
- Use short paragraphs and bullet points. Never a wall of text.
- Shortest wording that still carries the fact and the reason. Cut every word that earns nothing: "in order to" → "to", "at this point in time" → "now", "it appears that" → delete.
- Be direct and confident. No "it may potentially be advisable to consider".`;

const CASUAL_PROMPT = `You are FinGuard Intelligence's assistant, helping a user understand their own transaction data and financial-crime concepts.

Answer in plain conversational English, 2-5 sentences. If the user asks about their data, answer using ONLY the evidence brief provided — quote real account names and amounts from it. If the brief says no data is uploaded, say so and suggest uploading a CSV. Never invent transactions.

${PLAIN_LANGUAGE_RULES}`;

const INVESTIGATE_PROMPT = `You are FinGuard Intelligence, a 4-agent financial-crime analysis system. You are given a pre-computed evidence brief about the user's real transactions.

Respond with ONLY a valid JSON array of exactly 4 objects. No markdown fence, no preamble.

Each object: {"agent": string, "headline": string, "content": string, "findings": string[], "confidence": number}
- "headline": one punchy sentence summarising that agent's verdict (max 90 chars). Put the single most alarming fact here, with its real number.
- "content": 3-4 BULLET POINTS, one per line, each starting with "• ". NOT paragraphs.
- "findings": 2-3 short supporting facts with real numbers or account names, each inside this agent's own subject. Observations only — never actions, never outcomes. "ACC-X received ₹44.35 L from 5 payers" is a finding; "ACC-X frozen" or "KYC reviewed" is not. These must be facts your bullets did NOT already state — a different angle on the same group, not the same sentence with the words moved. If a bullet says "9 accounts in a chain moving ₹4.00 Cr", then "9 accounts moving ₹4.00 Cr" is the same fact and is banned; the banks it spans, the share of the portfolio it represents, or the dates it ran on are all fair. If you genuinely have nothing new, return fewer findings rather than padding.
- "confidence": 0-1, based on how strong the evidence actually is.

BE SHORT. The reader is skimming on a screen, not studying a filing. Each agent's four bullets together must read in under twenty seconds. If a bullet needs a comma-spliced second clause to survive, cut the clause.

EVERY BULLET HAS TWO HALVES: the fact, then why it matters — joined by " — ". Between 12 and 22 words, and never more than 22. Under 12 words it is a bare statistic and useless; over 22 it is the wall of text the user complained about. No introductions, no "in conclusion", no restating the question.

NEVER SPELL OUT A LIST. The brief names all seven banks because it is a working document; a bullet that repeats them spends 12 of its 22 words on proper nouns and says nothing. Write "7 banks", not the roll-call. Same for accounts: name at most two in a bullet, and say "9 accounts" for the rest. Counting beats listing every time.

Use everyday words. Write "kept a cut" not "retained a margin", "passed it straight on" not "onward-transmitted the funds", "split into smaller payments" not "disaggregated". If a word would stop a shop owner mid-sentence, it is the wrong word.

Good: "• Nine payments of ₹8.65-9.48 L each — every one sized to stop just short of the ₹10 L reporting line."
Bad, too bare (a number with no meaning): "• ₹82.88 L in 9 transfers under ₹10 L"
Bad, too vague (no real figures): "• Our analysis identified concerning patterns suggesting possible attempts to avoid detection through structuring."
Bad, too long (says it twice): "• Nine separate payments ranging between ₹8.65 L and ₹9.48 L, amounting to ₹82.88 L in total, were each deliberately sized to remain below the ₹10 L threshold at which reporting obligations are triggered."

USE THE HARD FINDINGS SECTION. It comes first in the brief and it is the actual case — each entry (F1, F2, …) already carries the exact amounts, dates, account names and reasoning. Every agent must work from it. The ring list further down is only the map; an answer built from ring sizes and totals alone is a failure.

RULES THAT DECIDE WHETHER THIS IS ANY GOOD:
- Never state a number without saying what it means. "₹2.77 Cr across 7 accounts" is a statistic; "money shrank 7.3% over 6 hops because each account kept a cut" is a finding.
- Every comparison you draw must fit the finding you are discussing. Take the percentages, dates and amounts from that specific finding — do not carry a number from one finding onto another.
- A number and the count beside it must come from the SAME source line, and this applies to every agent, in "content" and in "findings" alike. A ring's total goes only with that ring's account count; a finding's amount goes only with that finding's own count of payers or hops. They are different numbers about different things, and crossing them prints a figure that is flatly wrong. If a ring line says "7 accounts … ₹86.35 L" and a finding says "received ₹44.35 L from 5 different accounts", then "₹86.35 L from 5 accounts" and "collects from 7 accounts" are both errors. Write "₹44.35 L from 5 payers", or "the 7-account group moving ₹86.35 L" — never a half of each.
- When a finding gives a date, name the date. "Six hops on 6 August" lands; "a series of transfers" does not. When it gives no date, say nothing about when — do not borrow a date from another finding.
- The four agents must not say the same thing four times. Each answers its own question: what the network looks like / why it is wrong / which law it breaks / what to do on Monday morning.
- NEVER print the internal labels from the brief. No "F1", "F2", "finding F3", "R1", "BANK-HOP", "THRESHOLD-HUG", "FUNNEL-IN". The reader has never seen the brief and these mean nothing to them. Describe the thing itself: "the nine payments that all stopped just short of ₹10 lakh".
- Never assert a fact the brief does not contain. You do not know whether KYC papers are missing or forged, who owns an account, or what anyone intended — you know what the transfers did. Write "re-verify this account's KYC against its turnover", never "its KYC may be incomplete or falsified". Give the reason to check from the transfers themselves: "₹1.04 Cr passed through in a day".

The 4 agents, in this exact order:

1. "Graph Analyst" — the money map only, nothing about legality or next steps. One bullet per suspicious group: its shape (chain / funnel / fan-out) in ordinary words, its total, and what that shape tells you about who controls the money.
   Every number in these bullets comes off ONE R-line in RINGS DETECTED, and the values travel together: that line's account count, that line's total, that line's hub. If an R-line reads "5 accounts … ₹2.04 Cr … Hub(s): ACC-X", the only correct phrasing is "5 accounts around ACC-X moving ₹2.04 Cr". Say "N accounts in the group" — you are describing the whole group, not how many of them pay in, so never reach into a finding for a payer count here.
   When an R-line reads "Hub(s): none" there is NO hub, and naming one is a fabrication. A chain has no centre — it has two ends. Describe it by its run: "a 9-account chain running from ACC-A to ACC-Z, ₹4.00 Cr". Do not write "accounts around ACC-A" for a chain, and never promote the first account of a route into a hub. Say nothing at all about a hub in that case — "around no hub" and "with no central hub" are not sentences a reader wants; simply describe the group without one.
   Never call a total large or small on its own. ₹3 L next to a ₹4 Cr portfolio is a rounding error, and calling it large tells the reader the opposite of the truth. Either compare it to the PORTFOLIO total, or give the figure and say nothing about its size. One final bullet on which groups are boring and can be ignored.

2. "Risk Analyst" — what is actually wrong, nothing about the law. One bullet per hard finding, worst first. Each bullet: what happened with its own amount and date, then why that isn't normal — "ordinary payments don't shrink at every hop", "amounts don't cluster in a narrow band by chance".

3. "Compliance Officer" — one bullet per rule, covering EXACTLY these, in this order, and no others. Do not invent statutes or cite rules about banking secrecy or confidentiality:
   (a) PMLA 2002 / FIU-IND — STR due within 7 working days of forming suspicion; suspicion is the trigger, not the payment size. A CTR covers CASH above ₹10 lakh, so never call a UPI, IMPS, NEFT, RTGS or SWIFT transfer a CTR. Cross-border wires are reportable separately from ₹5 lakh up.
   (b) RBI KYC Master Direction — pass-through accounts must be re-verified.
   (c) FEMA 1999 — include ONLY if the brief says money left India; otherwise omit this bullet entirely.
   (d) FATF Recommendation 20 — cross-border and cross-bank layering.
   Each bullet: what the rule requires, which finding here engages it, and the filing plus deadline. Name real amounts and accounts — "STR required" alone is not a bullet.

4. "Investigation Assistant" — what to do on Monday morning, as numbered points ("1. ", "2. ", …). Name the exact accounts and say WHY each step, not just what: "Freeze ACC-X first — it takes money from 6 unrelated payers and empties within a day." Every point must be something a person can go and do — no "conduct a thorough investigation".

${PLAIN_LANGUAGE_RULES}`;

// Groq retires models on a rolling schedule, and a route pinned to one model id
// dies silently the day its model goes: the endpoint answers 404
// model_not_found, every AI call fails, and the reply quietly comes from the
// local engine instead. From the outside that looks exactly like "the AI worked
// for a couple of days and then stopped" — and it recurs, because replacing the
// API key never touched the real cause. So the model is a chain, not a constant,
// and the chain can rebuild itself from Groq's own catalogue if every id in it is
// ever retired at once.
//
// The per-minute token ceiling matters as much as the model does, and it is the
// other half of the same complaint. Groq charges prompt + max_tokens against the
// allowance up front, and one full investigation is between 6,000 and 8,000
// tokens of it, so a single investigation very nearly empties the free tier's
// per-minute budget in one shot. Casual chat is far cheaper and fits easily —
// which is exactly why chatting kept working while "Run full investigation"
// quietly served the local engine.
//
// The ceilings below are the ones actually observed on this account, not the ones
// advertised in the response headers. groq/compound reports 70,000 but routes
// internally to llama-3.3-70b-versatile and inherits its 12,000, so that is the
// number worth reasoning about. The two gpt-oss models share a single 8,000
// bucket between them.
//
// Declaration order is fastest first; chainFor() promotes the roomier models when
// a request is too big for the quick ones.
const CATALOGUE: { id: string; tpm: number }[] = [
  { id: "openai/gpt-oss-120b", tpm: 8_000 },
  { id: "openai/gpt-oss-20b", tpm: 8_000 },
  // Not compound-mini: on the full investigate prompt it returns an empty
  // completion every time, which costs seven seconds to learn nothing.
  { id: "groq/compound", tpm: 12_000 },
];
const MODELS = CATALOGUE.map((m) => m.id);

// Models that cannot hold the request are still tried, last: the estimate is
// deliberately rough, and a long shot beats refusing to ask.
const chainFor = (needed: number) => [
  ...CATALOGUE.filter((m) => m.tpm >= needed).map((m) => m.id),
  ...CATALOGUE.filter((m) => m.tpm < needed).map((m) => m.id),
];

// Four characters per token is crude, but it only has to be good enough to tell
// an 8,000-token request from a 3,000-token one.
const estimateTokens = (messages: { content: string }[], maxTokens: number) =>
  Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4) + maxTokens;

// Ids this process has proven are gone, ids whose daily budget is spent (with
// the moment it ran out), and anything a catalogue lookup turned up. All three
// are per-process on purpose: a redeploy or a cold start re-tests everything,
// which is the right cadence for facts that only change when Groq retires a
// model or a 24-hour window rolls over.
const decommissioned = new Set<string>();
const outOfQuota = new Map<string, number>();
// Some models refuse a large request outright with 413 rather than answering or
// reporting a token limit — groq/compound does exactly that with the full
// investigation prompt. Remember the size that was refused so requests that big
// skip the model next time, while smaller ones still get to use it.
const refusedAbove = new Map<string, number>();
let discovered: string[] = [];
const QUOTA_RETRY_MS = 60 * 60 * 1000;

// A full investigation costs most of the free tier's per-minute token allowance,
// so two clicks in close succession cannot both reach the AI — the second used to
// drop to the local engine, which looks like the feature breaking at precisely
// the worst moment, with somebody watching. But the data behind a report does not
// change between those two clicks, so the report does not need to either. Keeping
// the last few successful answers means a repeated question comes back instantly,
// spends no quota, and reads identically to the first time. This is what makes a
// demo repeatable rather than a coin toss.
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX = 24;
const cache = new Map<string, { at: number; model: string; content: string }>();

// FNV-1a. Short, stable, and good enough to tell one evidence brief from another.
function fingerprint(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const isGone = (status: number, detail: string) =>
  status === 404 ||
  /model_not_found|model_decommissioned|decommissioned|has been deprecated|does not exist/i.test(detail);

const isDailyCap = (detail: string) =>
  /per day|tokens per day|requests per day|\bTPD\b|\bRPD\b/i.test(detail);

// The gpt-oss models reason before answering, and by default that reasoning is
// billed against the same per-minute allowance as the answer even though this
// route only ever reads `content`. Measured on the real investigate request:
// 1,309 tokens a call by default against 709 with low effort and the trace
// hidden — the same four agents for 46% less, so nearly twice as many
// investigations fit inside the free tier's 8,000-per-minute window. Only that
// family accepts these two fields, so they are gated on the id rather than sent
// blind and risking a 400.
const tuningFor = (model: string) =>
  model.startsWith("openai/gpt-oss")
    ? { reasoning_effort: "low", reasoning_format: "hidden" }
    : {};

// Called only when every id we know about has come back 404 — the exact scenario
// this mechanism exists for. Groq's own catalogue is the one source that is
// always current, so ask it rather than waiting for someone to notice the outage
// and edit this file.
async function discoverModels(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: { id?: string; context_window?: number }[] };
    return (body.data ?? [])
      .filter((m): m is { id: string; context_window?: number } => typeof m.id === "string")
      // Speech, embedding and moderation models cannot answer a chat turn at
      // all, and the investigate prompt alone runs to about 2,500 tokens, so a
      // small context window is a guaranteed failure rather than a gamble.
      .filter((m) => !/whisper|tts|embed|guard/i.test(m.id) && (m.context_window ?? 0) >= 16_000)
      .sort((a, b) => (b.context_window ?? 0) - (a.context_window ?? 0))
      .map((m) => m.id)
      .filter((id) => !decommissioned.has(id))
      .slice(0, 3);
  } catch {
    return [];
  }
}

type GroqResult =
  | { ok: true; content: string; model: string }
  | { ok: false; status: number; detail: string; rateLimited: boolean; daily: boolean; retryMs: number };

// One request to one model, no retrying. The caller decides whether waiting or
// moving along the chain is the better answer to whatever came back, because that
// judgement needs to see the whole chain and this function only sees one model.
async function tryModel(
  apiKey: string,
  body: Record<string, unknown>,
  model: string
): Promise<GroqResult> {
  let res: Response;
  try {
    res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, model, ...tuningFor(model) }),
    });
  } catch (err) {
    return { ok: false, status: 0, detail: String(err), rateLimited: false, daily: false, retryMs: 0 };
  }

  if (res.ok) {
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return { ok: true, content: data.choices?.[0]?.message?.content ?? "", model };
  }

  const detail = (await res.text().catch(() => "")).slice(0, 400);
  const retryAfter = Number(res.headers.get("retry-after"));
  return {
    ok: false,
    status: res.status,
    detail,
    rateLimited: res.status === 429,
    daily: res.status === 429 && isDailyCap(detail),
    retryMs: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 8000) : 1500,
  };
}

// `validate` lets the caller reject a 200 that this route cannot actually use.
// The investigate path needs parseable JSON for four agents, and a model can
// return prose, or truncate the JSON at max_tokens, and still call that success —
// which used to spend the whole request and drop to the local engine while two
// perfectly good models sat further down the chain untried. An unusable answer is
// now treated like any other failure: keep walking.
async function askGroq(
  apiKey: string,
  body: Record<string, unknown>,
  validate: ((content: string) => boolean) | undefined,
  needed: number
): Promise<GroqResult> {
  const usable = (m: string) =>
    !decommissioned.has(m) &&
    Date.now() - (outOfQuota.get(m) ?? 0) > QUOTA_RETRY_MS &&
    needed < (refusedAbove.get(m) ?? Infinity);
  const pool = () => [...chainFor(needed), ...discovered];

  let last: GroqResult = {
    ok: false,
    status: 503,
    detail: "no Groq model available",
    rateLimited: false,
    daily: false,
    retryMs: 0,
  };
  // An answer that arrived but failed validation. Kept so that if nothing in the
  // chain validates, the caller still sees a real 200 and can report "the AI
  // returned something unreadable" rather than "the AI was unreachable".
  let unusable: GroqResult | null = null;
  const capped: { model: string; retryMs: number }[] = [];

  // One shot at each model in turn, recording why each one failed. A per-minute
  // cap on one model says nothing about the next one's allowance — Groq counts
  // quotas per model — so walking the chain answers in about two seconds where
  // waiting out a retry-after took eighteen. Retirements and daily caps are
  // recorded as they are found, so every later request in this process skips
  // those models outright.
  const walk = async (chain: string[]): Promise<GroqResult | null> => {
    for (const model of chain) {
      const r = await tryModel(apiKey, body, model);

      if (r.ok) {
        if (!validate || validate(stripThinking(r.content))) return r;
        console.warn(
          `[FinGuard] ${model} answered with output this route cannot parse (${r.content.length} chars); trying the next model.`
        );
        unusable ??= r;
        continue;
      }

      last = r;

      if (isGone(r.status, r.detail)) {
        console.error(`[FinGuard] Groq no longer serves ${model} (${r.status}); trying the next model.`);
        decommissioned.add(model);
      } else if (r.status === 413) {
        console.warn(`[FinGuard] ${model} refused a ${needed}-token request as too large; skipping it for requests this big.`);
        refusedAbove.set(model, Math.min(refusedAbove.get(model) ?? Infinity, needed));
      } else if (r.daily) {
        outOfQuota.set(model, Date.now());
      } else if (r.rateLimited) {
        capped.push({ model, retryMs: r.retryMs });
      }
      // A 400 means this body is wrong for this model — response_format being
      // the usual culprit — and a 5xx means Groq is struggling with it.
      // Repeating fixes neither, but the next model may serve both: move on.
    }
    return null;
  };

  let answer = await walk(pool().filter(usable));
  if (answer) return answer;

  // Every id we know about is retired — including any this very walk just found
  // out about. Ask Groq what it actually serves and try that now, in this same
  // request: a retirement should cost one slow answer, not a dead feature until
  // somebody notices and edits this file. Checked after the walk rather than
  // before it, because before it the retirements have not been discovered yet.
  if (pool().every((m) => decommissioned.has(m))) {
    discovered = await discoverModels(apiKey);
    if (discovered.length) {
      console.warn(
        `[FinGuard] every pinned Groq model is retired; falling back to the live catalogue: ${discovered.join(", ")}`
      );
      answer = await walk(discovered.filter(usable));
      if (answer) return answer;
    }
  }

  // Nothing was free, so waiting is the only move left. Per-minute caps clear in
  // seconds; take the one clearing soonest and give it one more try. Only one,
  // because the handler has a 60-second ceiling and a fallback report the user
  // can actually read beats a request that times out.
  const soonest = capped.sort((a, b) => a.retryMs - b.retryMs)[0];
  if (soonest) {
    await new Promise((r) => setTimeout(r, soonest.retryMs));
    const r = await tryModel(apiKey, body, soonest.model);
    if (r.ok && (!validate || validate(stripThinking(r.content)))) return r;
    if (r.ok) unusable ??= r;
    else {
      last = r;
      if (r.daily) outOfQuota.set(soonest.model, Date.now());
    }
  }

  return unusable ?? last;
}

// A model chosen by discovery may be a reasoning model that prints its
// scratchpad into `content` rather than a separate field. That must never reach
// the reader, and it must not break JSON parsing for the agent panel.
const stripThinking = (text: string) =>
  text
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .replace(/<\/?think(?:ing)?>/gi, "")
    .trim();

function wantsInvestigation(msg: string): boolean {
  const m = msg.toLowerCase();
  const keywords = [
    "investigate", "investigation", "analyze", "analyse", "audit", "review",
    "suspicious", "risk", "anomal", "launder", "structur", "sar", "str",
    "typology", "compliance", "agents", "full report", "deep dive",
    "why is", "what patterns", "flag", "explain everything", "what's wrong",
    "whats wrong", "find", "detect",
  ];
  return keywords.some((k) => m.includes(k));
}

// The chat API only accepts system/user/assistant. The client keeps richer
// roles for its own bubbles ("report", "agent"), and one of those reaching the
// model returned HTTP 400 for the whole turn, so the answer arrived as "AI
// service unavailable". Anything that isn't a user turn is folded into
// assistant, and entries without usable text are dropped rather than sent.
function sanitizeHistory(history: unknown) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-6)
    .map((m) => {
      const role = (m as { role?: unknown })?.role;
      const content = (m as { content?: unknown })?.content;
      if (typeof content !== "string" || !content.trim()) return null;
      return { role: role === "user" ? "user" : "assistant", content };
    })
    .filter((m): m is { role: string; content: string } => m !== null);
}

export async function POST(req: Request) {  try {
    const { message, history, context, mode: forcedMode } = await req.json();

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const investigate =
      forcedMode === "investigate" ||
      (forcedMode !== "casual" && wantsInvestigation(message));

    // Analyse the data server-side first. This is what makes answers specific.
    const txs: Transaction[] = Array.isArray(context) ? context : [];
    const evidence = buildEvidence(txs);
    const brief = evidenceBrief(evidence);

    // Nothing to investigate — answer from the local engine rather than asking
    // the model to improvise. Sent to the AI it produced four near-identical
    // "there is no data" bubbles, which read exactly like the cold, generic
    // reply this whole path exists to avoid.
    if (investigate && !evidence.txCount) {
      return NextResponse.json(investigatePayload(evidence, localReport(evidence)));
    }

    const apiKey = process.env.GROQ_API_KEY;

    // No key, or no data — still give a real report rather than an error.
    if (!apiKey) {
      if (investigate) {
        return NextResponse.json(
          investigatePayload(
            evidence,
            localReport(evidence),
            "Running on the local analysis engine (no AI key configured)."
          )
        );
      }
      return NextResponse.json({
        mode: "casual",
        reply: "The AI service isn't configured, so I can't chat freely — but the Run full investigation button still works, it uses the built-in analysis engine.",
        suggestions: followUps(evidence),
      });
    }

    const messages = [
      { role: "system", content: investigate ? INVESTIGATE_PROMPT : CASUAL_PROMPT },
      ...sanitizeHistory(history),
      { role: "user", content: `${message}\n\n=== EVIDENCE BRIEF (computed from the user's real data) ===\n${brief}` },
    ];

    // Bullets, not essays — a report lands in well under this, and the free
    // tier's daily token budget is spent far slower with a realistic cap.
    const maxTokens = investigate ? 1400 : 500;

    // Only investigations are cached. A report is a function of the data and the
    // question, so repeating either should give the same answer — whereas a
    // casual turn depends on the conversation so far, which is not in this key.
    const key = investigate ? `${fingerprint(message.trim().toLowerCase())}:${fingerprint(brief)}` : null;
    if (key) {
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        const cachedAgents = parseAgents(hit.content);
        if (cachedAgents) {
          return NextResponse.json({
            ...investigatePayload(evidence, cachedAgents),
            model: hit.model,
            cached: true,
          });
        }
        cache.delete(key);
      }
    }

    const outcome = await askGroq(
      apiKey,
      {
        messages,
        temperature: investigate ? 0.4 : 0.7,
        max_tokens: maxTokens,
        ...(investigate ? { response_format: { type: "json_object" } } : {}),
      },
      // Only the investigate path has a shape it must hit. A casual reply is
      // whatever the model said, so any non-empty answer is usable.
      investigate ? (content) => parseAgents(content) !== null : (content) => content.trim().length > 0,
      estimateTokens(messages, maxTokens)
    );

    if (!outcome.ok) {
      console.error("[FinGuard] Groq unavailable:", outcome.status, outcome.detail);
      const { rateLimited, daily } = outcome;
      // A daily cap needs hours, a per-minute cap needs seconds. Saying "wait a
      // minute" when the answer is "wait until tomorrow" just wastes the user's
      // time on retries that cannot succeed.
      const waitAdvice = daily
        ? "You've used up today's free AI quota — it resets on a rolling 24-hour window."
        : "The free AI tier only allows so many requests a minute.";

      if (investigate) {
        return NextResponse.json(
          investigatePayload(
            evidence,
            localReport(evidence),
            rateLimited
              ? `${waitAdvice} This report came from the built-in analysis engine instead — it reads the same data, just without the AI's wording.`
              : "The AI service was unreachable, so this report came from the local analysis engine."
          )
        );
      }
      // Casual questions have no local equivalent, so say what happened in
      // plain words instead of surfacing a bare status code.
      return NextResponse.json({
        mode: "casual",
        reply: rateLimited
          ? `${waitAdvice} That's a limit on the free plan, not a problem with your data or your key. ${daily ? "Run full investigation still works in the meantime — it uses the built-in engine and needs no AI." : "Give it a minute and ask again, or use Run full investigation, which works either way."}`
          : "The AI service didn't respond just now. Try again in a moment — Run full investigation works either way, since it can fall back to the built-in engine.",
        suggestions: followUps(evidence),
        degraded: rateLimited ? waitAdvice : "AI service unavailable.",
      });
    }

    const raw = stripThinking(outcome.content);

    if (!investigate) {
      const clean = raw.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();
      // Which model answered rides along on every reply. It costs nothing, it is
      // not a secret, and it turns "the AI is being weird again" into one glance
      // at the network tab.
      return NextResponse.json({
        mode: "casual",
        reply: clean,
        suggestions: followUps(evidence),
        model: outcome.model,
      });
    }

    const agents = parseAgents(raw);
    if (!agents) {
      return NextResponse.json(
        investigatePayload(
          evidence,
          localReport(evidence),
          "The AI returned an unreadable response, so this report came from the local analysis engine."
        )
      );
    }

    if (key) {
      // Oldest first out. Map keeps insertion order, so the first key is the
      // stalest — a plain bound, not a real LRU, because 24 entries of a
      // single-user demo never need one.
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(key, { at: Date.now(), model: outcome.model, content: raw });
    }

    return NextResponse.json({ ...investigatePayload(evidence, agents), model: outcome.model });  } catch (err) {
    console.error("[FinGuard] Chat API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// The model may return a bare array, or an object wrapping one under any key
// (json_object mode forces an object). Accept every shape rather than falling
// back to a generic message.
function parseAgents(raw: string) {
  const attempt = (text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  let parsed = attempt(raw.trim());
  if (!parsed) {
    const arr = raw.match(/\[[\s\S]*\]/);
    if (arr) parsed = attempt(arr[0]);
  }
  if (!parsed) {
    const obj = raw.match(/\{[\s\S]*\}/);
    if (obj) parsed = attempt(obj[0]);
  }
  if (!parsed) return null;

  if (Array.isArray(parsed)) return normalize(parsed);
  if (typeof parsed === "object") {
    for (const value of Object.values(parsed)) {
      if (Array.isArray(value) && value.length) return normalize(value);
    }
  }
  return null;
}

// The brief labels its findings F1, F2 and its rings R1, R2 so the model can
// hold them apart. The reader has never seen the brief, so "F2 engages RBI KYC"
// is a reference to nothing. The prompt forbids printing them and mostly that
// holds, but it is one sampling away from failing, and a citation to an invisible
// document is the kind of thing a judge notices. Swapping in the plain noun the
// label stood for leaves the sentence grammatical either way.
// The lookarounds keep it off account names — ACC-R1 is a name, not a ring.
function stripInternalLabels(text: string) {
  return text
    .replace(/(?<![-\w])F(\d{1,2})(?![-\w])/g, "this finding")
    .replace(/(?<![-\w])R(\d{1,2})(?![-\w])/g, "this group")
    .replace(/\bfinding this finding\b/gi, "this finding")
    .replace(/\bring this group\b/gi, "this group");
}

// The model mirrors the indentation of the prompt's own nested lists, so bullets
// arrive with six leading spaces. Strip it here rather than asking it not to.
function tidyBullets(text: string) {
  return stripInternalLabels(text)
    .split("\n")
    .map((l) => l.trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join("\n")
    .trim();
}

function normalize(list: unknown[]) {
  const cleaned = list
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .map((a) => ({
      agent: String(a.agent ?? a.name ?? "Investigation Assistant"),
      headline:
        typeof a.headline === "string" ? stripInternalLabels(a.headline.trim()) : undefined,
      content: tidyBullets(String(a.content ?? a.text ?? a.analysis ?? "")),
      findings: Array.isArray(a.findings)
        ? a.findings.map((f) => stripInternalLabels(String(f).trim())).filter(Boolean).slice(0, 4)
        : [],
      confidence: typeof a.confidence === "number" ? a.confidence : 0.85,
    }))
    .filter((a) => a.content.trim().length > 0);
  return cleaned.length ? cleaned : null;
}

function summarize(ev: ReturnType<typeof buildEvidence>) {
  return {
    txCount: ev.txCount,
    accountCount: ev.accountCount,
    ringCount: ev.rings.filter((r) => r.accounts.length >= 3).length,
    findingCount: ev.findings.length,
    highCount: ev.bySeverity.high,
  };
}

// ── The short answer ───────────────────────────────────────────────────────
// "Run full investigation" used to reply with four agent bubbles totalling a
// page of text. The verdict below is what the user actually asked for: how bad
// it is, in one sentence, with at most four facts behind it. It is computed
// from the evidence engine rather than the model, so it is always present, its
// numbers always match the data, and it costs no tokens.
function verdictOf(ev: Evidence): {
  level: Severity;
  headline: string;
  points: string[];
  accounts: string[];
} {
  if (!ev.txCount) {
    return {
      level: "safe",
      headline: "No transactions loaded yet.",
      points: ["Import a CSV from the Upload tab and run this again."],
      accounts: [],
    };
  }

  const hard = ev.findings.filter((f) => f.severity === "high");
  const level: Severity = hard.length || ev.bySeverity.high ? "high" : ev.bySeverity.medium ? "medium" : "safe";
  const rings = ev.rings.filter((r) => r.accounts.length >= 3);
  const named = Array.from(new Set(rings.map((r) => r.typology).filter(Boolean))) as string[];

  const headline =
    level === "high"
      ? `${hard.length || ev.bySeverity.high} serious problem${(hard.length || ev.bySeverity.high) === 1 ? "" : "s"} found — ` +
        `${formatINR(ev.highValue)} of ${formatINR(ev.totalValue)} is high-risk.`
      : level === "medium"
        ? `Nothing criminal stands out, but ${ev.bySeverity.medium} transfer${ev.bySeverity.medium === 1 ? "" : "s"} ` +
          `are large enough to keep an eye on.`
        : `All ${ev.txCount} transfers look routine. Nothing to escalate.`;

  const points: string[] = [];
  if (named.length) {
    points.push(`Patterns matched: ${named.slice(0, 4).join(", ")}.`);
  }
  for (const f of ev.findings.slice(0, 3)) points.push(f.short || f.title);
  if (points.length < 2) {
    points.push(
      `${ev.txCount} transfers, ${ev.accountCount} accounts, ${formatINR(ev.totalValue)} across ${ev.banks.length} bank${ev.banks.length === 1 ? "" : "s"}.`
    );
  }

  // The accounts the graph should open focused on: whatever the hard findings
  // actually name, worst finding first.
  const accounts: string[] = [];
  for (const f of hard.length ? hard : ev.findings) {
    for (const a of f.accounts) if (!accounts.includes(a)) accounts.push(a);
  }

  return { level, headline, points: points.slice(0, 4), accounts: accounts.slice(0, 14) };
}

// Follow-ups are generated from the data, not the model, so they always name
// something that exists and never cost a request.
function followUps(ev: Evidence): string[] {
  if (!ev.txCount) return ["How do I upload my transactions?", "What file format do you need?"];

  const out: string[] = [];
  const ring = ev.rings.find((r) => r.typology && r.accounts.length >= 3);
  if (ring?.typology) out.push(`Explain the ${ring.typology.toLowerCase()} in simple words`);
  const hub = ev.topCounterparties[0]?.account;
  if (hub) out.push(`Why is ${hub} suspicious?`);
  if (ev.findings.length) out.push("Which accounts should I freeze first?");
  out.push("What laws does this break?");
  out.push("Show me the biggest money flows");
  return out.slice(0, 3);
}

// Every investigate reply has the same shape; building it in one place stops the
// five exit paths from drifting apart.
function investigatePayload(ev: Evidence, agents: unknown, degraded?: string) {
  return {
    mode: "investigate" as const,
    agents,
    verdict: verdictOf(ev),
    suggestions: followUps(ev),
    evidence: summarize(ev),
    ...(degraded ? { degraded } : {}),
  };
}
