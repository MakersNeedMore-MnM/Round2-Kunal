"use client";

import { useState } from "react";
import { useTransactions, useDeleteTransaction } from "@/lib/hooks";
import { formatINR, detectPattern, type Severity } from "@/lib/mockData";
import { SeverityBadge } from "../ui/SeverityBadge";

export function TransactionsView() {
  const { transactions, loading } = useTransactions();
  const deleteTx = useDeleteTransaction();
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<"all" | Severity>("all");

  const filtered = transactions.filter((t) => {
    if (severity !== "all" && t.severity !== severity) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      t.fromAccount?.toLowerCase().includes(q) ||
      t.toAccount?.toLowerCase().includes(q) ||
      t.bank?.toLowerCase().includes(q) ||
      t.note?.toLowerCase().includes(q) ||
      detectPattern(t.note)?.label.toLowerCase().includes(q) ||
      String(t.amount).includes(q)
    );
  });

  return (
    <div className="p-5 min-h-full">
      <div
        className="rounded-2xl border"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
      >
        <div
          className="p-4 flex flex-wrap items-center gap-3 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by account, bank, note, amount..."
            className="flex-1 min-w-[240px] rounded-lg border px-3 py-2 text-[13px] outline-none focus:border-emerald-500/40"
            style={{ background: "var(--chip)", borderColor: "var(--border)", color: "var(--text)" }}
          />
          <div className="flex gap-1">
            {(["all", "high", "medium", "safe"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSeverity(s)}
                className={`rounded-lg border px-3 py-2 text-[12px] capitalize transition ${
                  severity === s ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : ""
                }`}
                style={
                  severity !== s
                    ? { borderColor: "var(--border)", background: "var(--chip)", color: "var(--text)" }
                    : undefined
                }
              >
                {s}
              </button>
            ))}
          </div>
          <div className="text-[12px]" style={{ color: "var(--muted-2)" }}>
            {filtered.length} of {transactions.length}
          </div>
        </div>

        {loading && (
          <div className="p-8 text-center text-[13px]" style={{ color: "var(--muted)" }}>
            Loading...
          </div>
        )}

        {!loading && transactions.length === 0 && (
          <div className="p-10 text-center">
            <div className="text-4xl mb-2">📁</div>
            <div className="text-[14px] font-medium" style={{ color: "var(--text-strong)" }}>
              No transactions yet
            </div>
            <div className="text-[12px] mt-1" style={{ color: "var(--muted-2)" }}>
              Import a CSV to get started
            </div>
          </div>
        )}

        {!loading && transactions.length > 0 && (
          <div className="overflow-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr
                  className="text-[11px] uppercase tracking-widest text-left"
                  style={{ background: "var(--chip)", color: "var(--muted)" }}
                >
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">From</th>
                  <th className="px-4 py-2">To</th>
                  <th className="px-4 py-2">Bank</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Risk</th>
                  <th className="px-4 py-2">Pattern</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr
                    key={t.id}
                    className="border-t hover:bg-[var(--hover)] transition"
                    style={{ borderColor: "var(--border)", color: "var(--text)" }}
                  >
                    <td className="px-4 py-2.5 font-mono text-[12px]">{t.date}</td>
                    <td className="px-4 py-2.5">{t.fromAccount}</td>
                    <td className="px-4 py-2.5">{t.toAccount}</td>
                    <td className="px-4 py-2.5">{t.bank}</td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      {t.currency === "INR" ? formatINR(t.amount) : `${t.amount.toLocaleString("en-IN")} ${t.currency}`}
                    </td>
                    <td className="px-4 py-2.5 text-[12px]" style={{ color: "var(--muted)" }}>
                      {t.type}
                    </td>
                    <td className="px-4 py-2.5">
                      <SeverityBadge severity={t.severity} />
                    </td>
                    <td className="px-4 py-2.5">
                      {(() => {
                        const p = detectPattern(t.note);
                        return p ? (
                          <span
                            className="inline-block rounded px-1.5 py-0.5 text-[10.5px] font-medium whitespace-nowrap"
                            style={{ background: `${p.color}22`, color: p.color }}
                          >
                            {p.label}
                          </span>
                        ) : (
                          <span className="text-[12px]" style={{ color: "var(--muted)" }}>—</span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => {
                          if (confirm("Delete this transaction?")) deleteTx(t.id);
                        }}
                        className="text-[11px] text-red-400/70 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="p-6 text-center text-[13px]" style={{ color: "var(--muted)" }}>
                No transactions match your filters
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
