import { NextResponse } from "next/server";
import { buildEvidence, evidenceBrief, localReport, type Evidence } from "@/lib/investigation";
import { formatINR, type Severity, type Transaction } from "@/lib/domain";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

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

// The free tier caps both tokens-per-minute and tokens-per-day, and both come
// back as a 429 that has nothing to do with the key or the data. A per-minute
// cap clears in seconds, so retry it; a daily cap clears in hours, so retrying
// only burns more requests — go straight to the local engine instead.
async function callGroq(apiKey: string, body: Record<string, unknown>) {
  let last: Response | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.status !== 429) return res;

    last = res;
    if (attempt === 2) break;

    // Clone so the caller can still read the body for its own error message.
    const detail = await res.clone().text().catch(() => "");
    if (/per day|TPD|RPD/i.test(detail)) break;

    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 8000)
      : 1200 * (attempt + 1);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  return last as Response;
}

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

    const response = await callGroq(apiKey, {
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: investigate ? 0.4 : 0.7,
      // Bullets, not essays — a report lands in well under this, and the free
      // tier's daily token budget is spent far slower with a realistic cap.
      max_tokens: investigate ? 1400 : 500,
      ...(investigate ? { response_format: { type: "json_object" } } : {}),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[FinGuard] Groq API error:", response.status, errText);
      const rateLimited = response.status === 429;
      // A daily cap needs hours, a per-minute cap needs seconds. Saying "wait a
      // minute" when the answer is "wait until tomorrow" just wastes the user's
      // time on retries that cannot succeed.
      const daily = rateLimited && /per day|TPD|RPD/i.test(errText);
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

    const data = await response.json();
    const raw: string = data.choices?.[0]?.message?.content ?? "";

    if (!investigate) {
      const clean = raw.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();
      return NextResponse.json({ mode: "casual", reply: clean, suggestions: followUps(evidence) });
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

    return NextResponse.json(investigatePayload(evidence, agents));
  } catch (err) {
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
