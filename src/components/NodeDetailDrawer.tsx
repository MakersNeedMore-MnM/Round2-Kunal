"use client";

import { useEffect, useMemo } from "react";
import {
  bankById,
  bankForAccount,
  detectPattern,
  formatINR,
  severityColor,
  type GraphEdge,
  type GraphNode,
  type Typology,
} from "@/lib/mockData";
import { SeverityBadge } from "./ui/SeverityBadge";

type Flow = {
  inCount: number;
  outCount: number;
  inAmount: number;
  outAmount: number;
  highShare: number;
  burst: number;
};

export function NodeDetailDrawer({
  node,
  edges,
  onClose,
}: {
  node: GraphNode | null;
  edges: GraphEdge[];
  onClose: () => void;
}) {
  const open = !!node;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const related = useMemo(() => {
    if (!node) return [];
    return edges.filter((e) => e.source === node.id || e.target === node.id);
  }, [node, edges]);

  // Which laundering typologies this specific account is involved in, read from
  // the narrations of its own transfers. An account can sit in more than one.
  const patterns = useMemo(() => {
    const tally = new Map<string, { t: Typology; count: number; amount: number }>();
    for (const e of related) {
      const p = detectPattern(e.note);
      if (!p) continue;
      const cur = tally.get(p.key);
      if (cur) {
        cur.count += 1;
        cur.amount += e.amount;
      } else {
        tally.set(p.key, { t: p, count: 1, amount: e.amount });
      }
    }
    return Array.from(tally.values()).sort((a, b) => b.count - a.count || b.amount - a.amount);
  }, [related]);

  const dominant = patterns.length ? patterns[0].t : null;

  const flow = useMemo<Flow>(() => {
    let inCount = 0, outCount = 0, inAmount = 0, outAmount = 0, highs = 0;
    const perDay = new Map<string, number>();
    for (const e of related) {
      if (node && e.target === node.id) {
        inCount += 1;
        inAmount += e.amount;
      } else {
        outCount += 1;
        outAmount += e.amount;
      }
      if (e.severity === "high") highs += 1;
      perDay.set(e.timestamp, (perDay.get(e.timestamp) ?? 0) + 1);
    }
    const burst = related.length ? Math.max(...Array.from(perDay.values())) : 0;
    return {
      inCount,
      outCount,
      inAmount,
      outAmount,
      highShare: related.length ? highs / related.length : 0,
      burst,
    };
  }, [related, node]);

  const connectedBankIds = useMemo(() => {
    if (!node) return [];
    const set = new Set<string>();
    related.forEach((e) => {
      const otherId = e.source === node.id ? e.target : e.source;
      const bank = bankForAccount(otherId);
      set.add(bank.id);
    });
    return Array.from(set).map((id) => bankById(id));
  }, [node, related]);

  // Risk bars derived from this account's own traffic, so two accounts in the
  // same ring don't read identically.
  const signals = useMemo(() => {
    const sevFloor = node?.severity === "high" ? 26 : node?.severity === "medium" ? 14 : 4;
    return {
      velocity: clamp(sevFloor + flow.burst * 16 + (dominant?.key === "layering" ? 22 : 0)),
      fanOut: clamp(8 + Math.max(flow.inCount, flow.outCount) * 17),
      counterparty: clamp(Math.round(flow.highShare * 88) + connectedBankIds.length * 4),
      kyc: clamp(96 - Math.round(flow.highShare * 62) - related.length * 3, 8),
    };
  }, [node, flow, dominant, connectedBankIds.length, related.length]);

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />
      <aside
        className={`fixed top-0 right-0 z-50 h-full w-[460px] max-w-full transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="h-full flex flex-col border-l" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
          {node && (
            <>
              <div className="p-5 border-b" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-start gap-3">
                  <div
                    className="w-10 h-10 rounded-lg grid place-items-center"
                    style={{
                      background: `${severityColor(node.severity)}22`,
                      color: severityColor(node.severity),
                      boxShadow: node.severity === "high" ? "0 0 16px rgba(239,68,68,0.45)" : undefined,
                    }}
                  >
                    ◉
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] uppercase tracking-widest" style={{ color: "var(--muted)" }}>
                        Anonymized handle
                      </span>
                      <SeverityBadge severity={node.severity} size="md" />
                    </div>
                    <div className="mt-1 font-mono text-[16px] break-all" style={{ color: "var(--text-strong)" }}>
                      {node.hash}
                    </div>
                    <div className="text-[12px]" style={{ color: "var(--muted-2)" }}>{node.label}</div>
                    {dominant && (
                      <span
                        className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]"
                        style={{
                          borderColor: `${dominant.color}55`,
                          background: `${dominant.color}18`,
                          color: dominant.color,
                        }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: dominant.color }} />
                        {dominant.label}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={onClose}
                    className="text-lg leading-none px-1"
                    style={{ color: "var(--muted)" }}
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <MiniStat label="Role in ring" value={roleOf(flow)} color="#a78bfa" />
                  <MiniStat label={`Received (${flow.inCount})`} value={formatINR(flow.inAmount)} color="#38bdf8" />
                  <MiniStat label={`Sent (${flow.outCount})`} value={formatINR(flow.outAmount)} color="#f59e0b" />
                </div>
              </div>

              <div className="p-5 overflow-auto space-y-5 flex-1">
                <section>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] uppercase tracking-widest text-emerald-300">Instant AI Explanation</span>
                    <span className="text-[10px] rounded px-1.5 py-0.5 bg-emerald-500/15 border border-emerald-500/25 text-emerald-300">
                      {dominant ? `${typologyCode(dominant.key)} · confidence ${confidenceOf(flow, !!dominant)}` : `confidence ${confidenceOf(flow, false)}`}
                    </span>
                  </div>
                  <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] p-3 text-[13px] leading-relaxed" style={{ color: "var(--text)" }}>
                    {aiExplanation(node, dominant, flow)}
                  </div>
                </section>

                {patterns.length > 0 && (
                  <section>
                    <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "var(--muted)" }}>
                      Typologies matched ({patterns.length})
                    </div>
                    <div className="space-y-1.5">
                      {patterns.map((p) => (
                        <div
                          key={p.t.key}
                          className="flex items-center gap-2 rounded-lg border px-2.5 py-2"
                          style={{ borderColor: `${p.t.color}33`, background: `${p.t.color}0D` }}
                        >
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ background: p.t.color, boxShadow: `0 0 8px ${p.t.color}` }}
                          />
                          <span className="text-[12.5px]" style={{ color: "var(--text)" }}>{p.t.label}</span>
                          <span className="ml-auto text-[11px] font-mono" style={{ color: "var(--muted)" }}>
                            {p.count} hop{p.count > 1 ? "s" : ""} · {formatINR(p.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <section>
                  <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "var(--muted)" }}>
                    Timeline breakdown ({related.length} events)
                  </div>
                  <ol className="relative border-l border-white/10 pl-4 space-y-3">
                    {related
                      .slice()
                      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
                      .map((e) => {
                        const otherId = e.source === node.id ? e.target : e.source;
                        const dir = e.source === node.id ? "out" : "in";
                        return (
                          <li key={e.id} className="relative">
                            <span
                              className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full"
                              style={{ background: severityColor(e.severity), boxShadow: `0 0 8px ${severityColor(e.severity)}` }}
                            />
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-mono" style={{ color: "var(--muted)" }}>{e.timestamp}</span>
                              <span className={`text-[10px] rounded px-1.5 py-0.5 border ${
                                dir === "out" ? "border-red-500/25 bg-red-500/10 text-red-300" : "border-sky-500/25 bg-sky-500/10 text-sky-300"
                              }`}>
                                {dir === "out" ? "→ outbound" : "← inbound"}
                              </span>
                              <SeverityBadge severity={e.severity} />
                            </div>
                            <div className="mt-1 text-[13px]" style={{ color: "var(--text)" }}>
                              {e.currency === "INR" ? formatINR(e.amount) : `${e.currency} ${e.amount.toLocaleString()}`}{" "}
                              <span style={{ color: "var(--muted)" }}>{dir === "out" ? "to" : "from"}</span>{" "}
                              <span className="font-mono">{otherId.length > 12 ? `${otherId.slice(0, 6)}…${otherId.slice(-4)}` : otherId}</span>
                            </div>
                            {e.note && <div className="text-[11.5px] italic" style={{ color: "var(--muted-2)" }}>— {e.note}</div>}
                          </li>
                        );
                      })}
                  </ol>
                </section>

                {connectedBankIds.length > 0 && (
                  <section>
                    <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "var(--muted)" }}>
                      Connected institutions
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {connectedBankIds.map((b) => (
                        <span
                          key={b.id}
                          className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[12px]"
                          style={{ borderColor: `${b.color}44`, background: `${b.color}12`, color: b.color }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: b.color }} />
                          {b.name}
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                <section>
                  <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "var(--muted)" }}>Risk signals</div>
                  <div className="grid grid-cols-2 gap-2">
                    <SignalBar label="Velocity anomaly" value={signals.velocity} color="#ef4444" />
                    <SignalBar label="Fan-out ratio" value={signals.fanOut} color="#f59e0b" />
                    <SignalBar label="Counterparty risk" value={signals.counterparty} color="#f59e0b" />
                    <SignalBar label="KYC completeness" value={signals.kyc} color="#38bdf8" />
                  </div>
                </section>
              </div>

              <div className="p-4 border-t flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
                <button className="flex-1 rounded-lg border px-3 py-2 text-[13px] hover:bg-[var(--hover)] transition" style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--chip)" }}>
                  Freeze account
                </button>
                <button className="flex-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 px-3 py-2 text-[13px] text-emerald-200 shadow-glow">
                  Escalate to SAR →
                </button>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border px-2.5 py-2" style={{ borderColor: `${color}33`, background: `${color}0E` }}>
      <div className="text-[10px] uppercase tracking-widest" style={{ color }}>{label}</div>
      <div className="mt-0.5 text-[13px] font-medium truncate" style={{ color: "var(--text-strong)" }}>{value}</div>
    </div>
  );
}

function SignalBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5">
      <div className="flex items-center justify-between text-[11px]">
        <span style={{ color: "var(--text)" }}>{label}</span>
        <span className="font-mono" style={{ color }}>{value}</span>
      </div>
      <div className="mt-1.5 h-1 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full" style={{ width: `${value}%`, background: `linear-gradient(90deg, ${color}, ${color}55)` }} />
      </div>
    </div>
  );
}

function clamp(v: number, min = 0, max = 98) {
  return Math.max(min, Math.min(max, Math.round(v)));
}

// Where the account sits in the chain of custody — derived from whether money
// only arrives, only leaves, or passes straight through.
function roleOf(flow: Flow) {
  if (flow.inCount && flow.outCount) return "Pass-through";
  if (flow.outCount) return "Originator";
  if (flow.inCount) return "Beneficiary";
  return "Isolated";
}

function roleClause(flow: Flow) {
  if (flow.inCount && flow.outCount) return "an intermediary hop";
  if (flow.outCount) return "the originating source";
  if (flow.inCount) return "a terminal beneficiary";
  return "an isolated account";
}

// FATF-style reference codes so each typology reads as a distinct finding.
const TYPOLOGY_CODES: Record<string, string> = {
  layering: "AML-TYP-04",
  structuring: "AML-TYP-02",
  mule: "AML-TYP-07",
  offshore: "AML-TYP-09",
  shell: "AML-TYP-11",
  roundtrip: "AML-TYP-05",
};

function typologyCode(key: string) {
  return TYPOLOGY_CODES[key] ?? "AML-TYP-00";
}

function confidenceOf(flow: Flow, tagged: boolean) {
  const base = tagged ? 0.82 : 0.61;
  return Math.min(0.97, base + flow.highShare * 0.12 + Math.min(0.04, flow.inCount * 0.01)).toFixed(2);
}

// The narrative is built from the account's own typology and traffic, so every
// node in the graph explains itself differently.
function aiExplanation(node: GraphNode, dominant: Typology | null, flow: Flow) {
  const role = roleClause(flow);
  const total = formatINR(flow.inAmount + flow.outAmount);
  const counterparties = flow.inCount + flow.outCount;
  const traffic = `${flow.inCount} inbound / ${flow.outCount} outbound transfer${counterparties === 1 ? "" : "s"} totalling ${total}`;

  switch (dominant?.key) {
    case "layering":
      return `${node.hash} sits on a rapid-layering chain as ${role}. Funds arrive and are pushed onward almost immediately, each hop shaving a small margin so the trail thins as it moves — ${traffic}. Sequential same-day hops across different institutions defeat single-bank monitoring, which is the signature of typology ${typologyCode("layering")}.`;
    case "mule":
      return `${node.hash} is part of a money-mule network, acting as ${role}. The ring collects many small deposits from unrelated individual accounts and consolidates them into one onward payout — ${traffic}. Deposit sizes cluster tightly and the funders share no commercial relationship, matching typology ${typologyCode("mule")}.`;
    case "structuring":
      return `${node.hash} appears in a structuring / smurfing fan-out as ${role}. A single source splits one large sum into several near-identical transfers deliberately parked just under the ₹10L reporting threshold — ${traffic}. Threshold-hugging amounts on the same day are the classic marker of typology ${typologyCode("structuring")}.`;
    case "shell":
      return `${node.hash} is wired into a shell-corporation funnel as ${role}. Several corporate entities with no visible trading activity route wire transfers into one beneficiary that immediately forwards the pooled balance — ${traffic}. Inflows with no matching invoices or payroll place this under typology ${typologyCode("shell")}.`;
    case "offshore":
      return `${node.hash} participates in an offshore transfer scheme as ${role}. Domestic funds are staged into a single collection account and then split across SWIFT wires to overseas beneficiaries — ${traffic}. The staging-then-exit shape and cross-border settlement match typology ${typologyCode("offshore")}.`;
    case "roundtrip":
      return `${node.hash} shows a round-trip / U-turn pattern as ${role}. Value leaves and returns through connected counterparties, giving illicit funds an apparently legitimate origin — ${traffic}. Circular settlement with no economic purpose maps to typology ${typologyCode("roundtrip")}.`;
    default:
      break;
  }

  if (node.severity === "high") {
    return `${node.hash} is flagged high-risk as ${role}, with ${traffic}. Volume and counterparty behaviour sit well above this account's baseline, though the narrations do not match a named typology — recommend manual triage before filing.`;
  }
  if (node.severity === "medium") {
    return `${node.hash} shows elevated value as ${role}, with ${traffic}. Amounts are above the routine-retail band but the counterparties are stable and no layering structure is present. Continued monitoring is sufficient for now.`;
  }
  return `${node.hash} shows normal activity as ${role}, with ${traffic}. It transacts with a single counterparty in line with its KYC-declared profile, and no laundering typology matched its narrations.`;
}
