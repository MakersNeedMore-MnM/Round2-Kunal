"use client";

import { useCallback, useMemo, useState } from "react";
import {
  buildGraphFromTransactions,
  formatINR,
  nodeRadius,
  severityColor,
  shortAccountLabel as shortLabel,
  type GraphCluster,
  type GraphEdge,
  type GraphNode,
} from "@/lib/mockData";
import { useTransactions } from "@/lib/hooks";
import { SeverityBadge } from "../ui/SeverityBadge";
import { NodeDetailDrawer } from "../NodeDetailDrawer";

type FilterKey = "all" | "safe" | "medium" | "high";

const LANE_COLORS = [
  "#38bdf8", "#a78bfa", "#f59e0b", "#22c55e", "#ec4899",
  "#06b6d4", "#f97316", "#8b5cf6", "#14b8a6", "#e11d48",
];

const W = 1240;

export function GraphView({
  focusAccounts,
  onClearFocus,
}: {
  // Accounts an investigator agent named, handed over when the user clicks
  // "View on graph" in the chat. Everything else on the canvas fades back.
  focusAccounts?: string[];
  onClearFocus?: () => void;
} = {}) {
  const { transactions, loading } = useTransactions();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const {
    nodes: NODES,
    edges: EDGES,
    bankNames: DYNAMIC_BANKS,
    clusters: CLUSTERS,
    height: H,
  } = useMemo(() => {
    if (!transactions.length)
      return {
        nodes: [] as GraphNode[],
        edges: [] as GraphEdge[],
        bankNames: [] as string[],
        clusters: [] as GraphCluster[],
        height: 560,
      };
    return buildGraphFromTransactions(transactions, W);
  }, [transactions]);

  const displayBanks = useMemo(() => {
    return DYNAMIC_BANKS.map((name, i) => ({
      id: `dyn-${i}`,
      name,
      code: name.split(" ").map((w) => w[0]).join("").slice(0, 3).toUpperCase(),
      color: LANE_COLORS[i % LANE_COLORS.length],
    }));
  }, [DYNAMIC_BANKS]);

  const nodeIndex = useMemo(() => {
    const m = new Map<string, GraphNode>();
    NODES.forEach((n) => m.set(n.id, n));
    return m;
  }, [NODES]);

  const visibleNodes = useMemo(
    () => NODES.filter((n) => (filter === "all" ? true : n.severity === filter)),
    [filter, NODES]
  );
  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => EDGES.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)),
    [visibleIds, EDGES]
  );

  // Accounts arriving from the chat, kept only if they exist on this canvas.
  const pinned = useMemo(
    () => (focusAccounts ?? []).filter((a) => nodeIndex.has(a)),
    [focusAccounts, nodeIndex]
  );

  // Two different jobs, kept apart on purpose. Accounts arriving from the chat
  // get a standing highlight — a marked ring plus a permanent label — and every
  // other node stays fully visible, because arriving on a canvas showing one
  // lit ring and nothing else hides the context that makes the ring mean
  // something. Hover is the transient one, and it only softens the rest rather
  // than blanking it, so the whole network stays readable without the pointer.
  const spread = useCallback(
    (roots: string[]) => {
      const s = new Set<string>(roots);
      EDGES.forEach((e) => {
        if (s.has(e.source)) s.add(e.target);
        if (s.has(e.target)) s.add(e.source);
      });
      return s;
    },
    [EDGES]
  );

  const highlightIds = useMemo(
    () => (pinned.length ? spread(pinned) : null),
    [pinned, spread]
  );

  const hoverIds = useMemo(
    () => (hover ? spread([hover]) : null),
    [hover, spread]
  );

  const highCount = NODES.filter((n) => n.severity === "high").length;
  const medCount = NODES.filter((n) => n.severity === "medium").length;

  if (loading) {
    return (
      <div
        className="p-5 flex items-center justify-center"
        style={{ height: "calc(100vh - 64px)", color: "var(--muted)" }}
      >
        Loading transactions…
      </div>
    );
  }

  if (NODES.length === 0) {
    return (
      <div
        className="p-5 flex flex-col items-center justify-center gap-3"
        style={{ height: "calc(100vh - 64px)" }}
      >
        <div className="text-[32px] opacity-30">◇</div>
        <div className="text-[14px] font-medium" style={{ color: "var(--text-strong)" }}>
          No transactions yet
        </div>
        <div className="text-[12.5px]" style={{ color: "var(--muted-2)" }}>
          Upload a CSV file to build the transaction graph.
        </div>
      </div>
    );
  }

  const canvasHeight = Math.min(660, Math.max(440, H));

  return (
    <div className="p-5 space-y-4">
      {/* ── Network canvas (full width) ─────────────────────────────────── */}
      <div
        className="rounded-2xl overflow-hidden border"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
      >
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--muted)" }}>
              Network Canvas
            </div>
            <span
              className="text-[11px] rounded px-1.5 py-0.5 border"
              style={{ borderColor: "var(--border)", background: "var(--chip)", color: "var(--muted)" }}
            >
              {CLUSTERS.length} clusters · {NODES.length} accounts
            </span>
            {highCount > 0 && (
              <span className="text-[11px] rounded px-1.5 py-0.5 bg-red-500/10 border border-red-500/25 text-red-300">
                {highCount} high-risk
              </span>
            )}
            {medCount > 0 && (
              <span className="text-[11px] rounded px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/25 text-amber-300">
                {medCount} medium
              </span>
            )}
            {pinned.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[11px] rounded px-1.5 py-0.5 bg-sky-500/10 border border-sky-500/30 text-sky-200">
                Focused on {pinned.length} {pinned.length === 1 ? "account" : "accounts"} from the investigation
                {onClearFocus && (
                  <button onClick={onClearFocus} className="underline decoration-dotted hover:text-sky-100">
                    clear
                  </button>
                )}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1">
              {(["all", "high", "medium", "safe"] as FilterKey[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`text-[11.5px] rounded-md border px-2.5 py-1 capitalize transition ${
                    filter === k
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                      : "hover:bg-[var(--hover)]"
                  }`}
                  style={filter !== k ? { borderColor: "var(--border)", color: "var(--text)" } : undefined}
                >
                  {k}
                </button>
              ))}
            </div>
            <div className="w-px h-5" style={{ background: "var(--border)" }} />
            <button
              onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))}
              className="w-7 h-7 rounded-md border hover:bg-[var(--hover)]"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
              aria-label="Zoom out"
            >
              −
            </button>
            <div className="text-[11px] font-mono w-10 text-center" style={{ color: "var(--muted)" }}>
              {Math.round(zoom * 100)}%
            </div>
            <button
              onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
              className="w-7 h-7 rounded-md border hover:bg-[var(--hover)]"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              onClick={() => setZoom(1)}
              className="text-[11px] rounded-md border px-2 py-1 hover:bg-[var(--hover)]"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              Reset
            </button>
          </div>
        </div>

        <div className="relative" style={{ height: canvasHeight, overflow: "hidden", background: "var(--bg)" }}>
          <div
            className="absolute inset-0"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "center center",
              transition: "transform 0.25s ease",
            }}
          >
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
              <defs>
                <marker id="arrowRed" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
                </marker>
                <marker id="arrowAmber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" />
                </marker>
                <marker id="arrowGreen" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#22c55e" />
                </marker>
                <radialGradient id="redGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="rgba(239,68,68,0.5)" />
                  <stop offset="100%" stopColor="rgba(239,68,68,0)" />
                </radialGradient>
              </defs>

              {/* Cluster frames — each ring captioned with its typology */}
              {CLUSTERS.map((c) => {
                if (!c.nodeIds.some((id) => visibleIds.has(id))) return null;
                return (
                  <g key={c.id} opacity={hoverIds ? 0.55 : 1}>
                    <rect
                      x={c.x}
                      y={c.y}
                      width={c.w}
                      height={c.h}
                      rx={16}
                      fill={`${c.color}0A`}
                      stroke={`${c.color}33`}
                      strokeWidth={1}
                      strokeDasharray={c.kind === "pairs" ? "7 6" : undefined}
                    />
                    <text
                      x={c.x + 14}
                      y={c.y + 18}
                      fontSize={10.5}
                      fill={c.color}
                      letterSpacing="0.08em"
                      fontWeight={600}
                    >
                      {c.label.toUpperCase()}
                    </text>
                    <text
                      x={c.x + c.w - 14}
                      y={c.y + 18}
                      fontSize={9.5}
                      textAnchor="end"
                      fill="#64748b"
                      className="font-mono"
                    >
                      {c.count} {c.kind === "pairs" ? "pairs" : "accounts"}
                    </text>
                  </g>
                );
              })}

              {/* Edges */}
              {visibleEdges.map((e) => {
                const s = nodeIndex.get(e.source);
                const t = nodeIndex.get(e.target);
                if (!s || !t) return null;
                const color = severityColor(e.severity);
                const isHigh = e.severity === "high";
                // An edge counts as lit when both ends are in the set, so a ring
                // reads as a connected path rather than loose dots. Highlighted
                // edges also carry their amount, which is the detail that made
                // hovering feel compulsory — now it is just there to read.
                const lit =
                  !!highlightIds && highlightIds.has(e.source) && highlightIds.has(e.target);
                const hovered = !!hoverIds && hoverIds.has(e.source) && hoverIds.has(e.target);
                const touched = lit || hovered;
                // Softened, never blanked: the rest of the network stays legible
                // so a highlighted ring can be read in context.
                const faded = !!hoverIds && !hovered;
                const marker =
                  e.severity === "high"
                    ? "url(#arrowRed)"
                    : e.severity === "medium"
                    ? "url(#arrowAmber)"
                    : "url(#arrowGreen)";
                return (
                  <g key={e.id} opacity={faded ? 0.5 : 1} style={{ transition: "opacity 0.15s ease" }}>
                    <path
                      d={curvePath(s.x, s.y, t.x, t.y)}
                      fill="none"
                      stroke={color}
                      strokeOpacity={touched ? 1 : isHigh ? 0.8 : 0.5}
                      strokeWidth={touched ? 2.4 : isHigh ? 1.8 : 1.3}
                      strokeDasharray={isHigh ? "6 6" : undefined}
                      markerEnd={marker}
                      className={isHigh ? "animate-dashmove" : ""}
                    />
                    {touched && (
                      <text
                        x={(s.x + t.x) / 2}
                        y={(s.y + t.y) / 2 - 6}
                        textAnchor="middle"
                        fontSize={10}
                        fill={color}
                        className="font-mono"
                        style={{ paintOrder: "stroke", stroke: "var(--bg)", strokeWidth: 3 }}
                      >
                        {formatINR(e.amount)}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Nodes */}
              {visibleNodes.map((n) => {
                const dynBank =
                  displayBanks.find((b) => b.name === n.bankName) ??
                  displayBanks[0] ?? { color: "#64748b", code: "?" };
                const isHover = hover === n.id;
                const isHigh = n.severity === "high";
                const color = severityColor(n.severity);
                const deg = n.degree ?? 1;
                const base = nodeRadius(deg);
                const r = isHover ? base + 3 : base;
                const isHub = deg >= 4;
                // Named by the agent, or one hop from an account it named.
                const isNamed = pinned.includes(n.id);
                const lit = !!highlightIds && highlightIds.has(n.id);
                const faded = !!hoverIds && !hoverIds.has(n.id);
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x}, ${n.y})`}
                    className="cursor-pointer"
                    opacity={faded ? 0.55 : 1}
                    style={{ transition: "opacity 0.15s ease" }}
                    onMouseEnter={() => setHover(n.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setSelected(n)}
                  >
                    {isHigh && <circle r={r + 14} fill="url(#redGlow)" />}
                    {/* Standing marker for accounts the agent named. Drawn once
                        and left there — the point of "view on graph" is to see
                        where the ring sits, not to hunt for it with the mouse. */}
                    {lit && (
                      <circle
                        r={r + 7}
                        fill="none"
                        stroke="#38bdf8"
                        strokeOpacity={isNamed ? 0.95 : 0.5}
                        strokeWidth={isNamed ? 2.4 : 1.4}
                        strokeDasharray={isNamed ? undefined : "3 3"}
                      />
                    )}
                    {isHigh && (isHub || isHover) && (
                      <circle r={r + 4} fill="none" stroke="#ef4444" strokeOpacity={0.5} strokeWidth={1.5}>
                        <animate attributeName="r" from={String(r + 4)} to={String(r + 18)} dur="1.6s" repeatCount="indefinite" />
                        <animate attributeName="opacity" from="0.7" to="0" dur="1.6s" repeatCount="indefinite" />
                      </circle>
                    )}
                    <circle
                      r={r}
                      fill="#0d1117"
                      stroke={color}
                      strokeWidth={isHub ? 2.6 : isHover ? 2.2 : 1.6}
                      style={{ filter: `drop-shadow(0 0 6px ${color}80)`, transition: "r 0.15s ease" }}
                    />
                    <circle r={Math.max(5, r * 0.38)} fill={color} opacity={0.9} />
                    {isHub && (
                      <text y={4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#0d1117">
                        {deg}
                      </text>
                    )}
                    <text
                      y={r + 14}
                      textAnchor="middle"
                      fontSize={9.5}
                      fontWeight={isHover || isHub || isNamed ? 700 : 400}
                      fill={isHover ? "#ffffff" : isNamed ? "#7dd3fc" : isHub ? "#e2e8f0" : "#94a3b8"}
                      className="font-mono"
                      style={{ paintOrder: "stroke", stroke: "var(--bg)", strokeWidth: 3 }}
                    >
                      {shortLabel(n.label)}
                    </text>
                    {/* Named accounts keep their bank and balance on screen
                        permanently; everything else reveals it on hover. */}
                    {(isHover || isNamed) && (
                      <text
                        y={r + 25}
                        textAnchor="middle"
                        fontSize={8.5}
                        fill={dynBank.color}
                        className="font-mono"
                        style={{ paintOrder: "stroke", stroke: "var(--bg)", strokeWidth: 3 }}
                      >
                        {dynBank.code} · {formatINR(Math.abs(n.balance))}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* HUD */}
          <div className="pointer-events-none absolute left-3 bottom-3 flex gap-2">
            <div
              className="rounded-md border px-2.5 py-1.5 text-[11px] font-mono"
              style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.45)", color: "var(--text)" }}
            >
              MPC · differential-privacy ε=0.42
            </div>
            {highCount > 0 && (
              <div
                className="rounded-md border border-red-500/25 px-2.5 py-1.5 text-[11px] font-mono text-red-300"
                style={{ background: "rgba(0,0,0,0.45)" }}
              >
                {highCount} HIGH RISK NODES DETECTED
              </div>
            )}
          </div>
          <div
            className="pointer-events-none absolute right-3 top-3 rounded-md border px-2.5 py-1.5 text-[11px] font-mono"
            style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.45)", color: "var(--text)" }}
          >
            Hover to isolate a ring · click for the full dossier
          </div>
        </div>
      </div>

      {/* ── Reference rails, below the canvas ───────────────────────────── */}
      <div className="grid grid-cols-12 gap-4">
        <div
          className="col-span-12 lg:col-span-4 rounded-2xl p-4 border"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        >
          <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--muted)" }}>
            Cluster Inspector
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            <Stat label="Nodes" value={String(NODES.length)} color="#38bdf8" />
            <Stat label="Edges" value={String(EDGES.length)} color="#a78bfa" />
            <Stat label="Rings" value={String(CLUSTERS.filter((c) => c.kind === "web").length)} color="#f59e0b" />
            <Stat label="High" value={String(highCount)} color="#ef4444" />
          </div>
          <div className="h-px my-4" style={{ background: "var(--border)" }} />
          <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "var(--muted)" }}>
            Institutions ({displayBanks.length})
          </div>
          <div className="space-y-2 max-h-40 overflow-auto pr-1">
            {displayBanks.map((b) => (
              <div key={b.id} className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-sm"
                  style={{ background: b.color, boxShadow: `0 0 8px ${b.color}` }}
                />
                <span className="text-[12.5px]" style={{ color: "var(--text)" }}>
                  {b.name}
                </span>
                <span className="ml-auto text-[11px] font-mono" style={{ color: "var(--muted)" }}>
                  {b.code}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div
          className="col-span-12 lg:col-span-4 rounded-2xl p-4 border"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        >
          <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "var(--muted)" }}>
            Detected typologies
          </div>
          <div className="space-y-1.5">
            {CLUSTERS.filter((c) => c.kind === "web").map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-md border px-2 py-1.5"
                style={{ borderColor: `${c.color}33`, background: `${c.color}0D` }}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: c.color, boxShadow: `0 0 8px ${c.color}` }} />
                <span className="text-[12px]" style={{ color: "var(--text)" }}>
                  {c.label}
                </span>
                <span className="ml-auto text-[11px] font-mono" style={{ color: "var(--muted)" }}>
                  {c.count} accts
                </span>
              </div>
            ))}
            {CLUSTERS.filter((c) => c.kind === "web").length === 0 && (
              <div className="text-[12px]" style={{ color: "var(--muted)" }}>
                No multi-account rings in this dataset.
              </div>
            )}
          </div>
          <div className="h-px my-4" style={{ background: "var(--border)" }} />
          <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "var(--muted)" }}>
            Legend
          </div>
          <div className="space-y-1.5 text-[12px]" style={{ color: "var(--text)" }}>
            <LegendRow color="#ef4444" label="High-risk account" />
            <LegendRow color="#f59e0b" label="Medium-risk account" />
            <LegendRow color="#22c55e" label="Safe account" />
            <div className="flex items-center gap-2 pt-1">
              <span className="grid place-items-center w-4 h-4 rounded-full border text-[8px] font-bold" style={{ borderColor: "#e2e8f0", color: "var(--text)" }}>
                n
              </span>
              <span>Number inside a node = counterparties</span>
            </div>
          </div>
        </div>

        <div
          className="col-span-12 lg:col-span-4 rounded-2xl p-4 border"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        >
          <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--muted)" }}>
            Largest hops
          </div>
          <div className="mt-2 max-h-64 overflow-auto pr-1 space-y-1.5">
            {EDGES.slice()
              .sort((a, b) => b.amount - a.amount)
              .slice(0, 10)
              .map((e) => {
                const s = nodeIndex.get(e.source);
                const t = nodeIndex.get(e.target);
                return (
                  <div
                    key={e.id}
                    className="flex items-center gap-2 text-[12px] rounded-md px-2 py-1.5 border"
                    style={{ background: "var(--bg)", borderColor: "var(--border)" }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: severityColor(e.severity) }} />
                    <span className="font-mono truncate" style={{ color: "var(--muted)" }}>
                      {shortLabel(s?.label ?? e.source)}→{shortLabel(t?.label ?? e.target)}
                    </span>
                    <span className="ml-auto font-mono" style={{ color: "var(--text)" }}>
                      {formatINR(e.amount)}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* ── Edge log ────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--muted)" }}>
            Edge Log
          </div>
          <div className="text-[11px] font-mono" style={{ color: "var(--muted)" }}>
            {visibleEdges.length} events
          </div>
        </div>
        <div className="max-h-56 overflow-auto">
          <table className="w-full text-[12px]">
            <thead style={{ color: "var(--muted)" }} className="text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">From</th>
                <th className="px-4 py-2 font-medium">To</th>
                <th className="px-4 py-2 font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Severity</th>
                <th className="px-4 py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {visibleEdges.map((e) => {
                const s = nodeIndex.get(e.source);
                const t = nodeIndex.get(e.target);
                return (
                  <tr key={e.id} className="border-t hover:bg-[var(--hover)]" style={{ borderColor: "var(--border)" }}>
                    <td className="px-4 py-2 font-mono" style={{ color: "var(--muted)" }}>
                      {e.timestamp}
                    </td>
                    <td className="px-4 py-2 font-mono" style={{ color: "var(--text)" }}>
                      {s?.hash ?? e.source}
                    </td>
                    <td className="px-4 py-2 font-mono" style={{ color: "var(--text)" }}>
                      {t?.hash ?? e.target}
                    </td>
                    <td className="px-4 py-2 font-mono">
                      {e.currency === "INR" ? formatINR(e.amount) : `${e.currency} ${e.amount.toLocaleString()}`}
                    </td>
                    <td className="px-4 py-2">
                      <SeverityBadge severity={e.severity} />
                    </td>
                    <td className="px-4 py-2" style={{ color: "var(--muted)" }}>
                      {e.note ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <NodeDetailDrawer node={selected} edges={EDGES} onClose={() => setSelected(null)} />
    </div>
  );
}

// Account handles all share an "ACC-" prefix; dropping it keeps the on-canvas
// label short enough that neighbouring nodes never collide.
function curvePath(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const nx = -dy;
  const ny = dx;
  const len = Math.sqrt(nx * nx + ny * ny) || 1;
  const off = Math.min(26, len * 0.12);
  const cx = mx + (nx / len) * off;
  const cy = my + (ny / len) * off;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border p-2" style={{ borderColor: `${color}33`, background: `${color}0F` }}>
      <div className="text-[17px] font-semibold leading-none" style={{ color: "var(--text-strong)" }}>
        {value}
      </div>
      <div className="mt-1 text-[9.5px] uppercase tracking-widest" style={{ color }}>
        {label}
      </div>
    </div>
  );
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-2 h-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      <span>{label}</span>
    </div>
  );
}
