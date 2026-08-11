"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { CommandDashboard } from "./views/CommandDashboard";
import { UploadView } from "./views/UploadView";
import { InvestigatorChat } from "./views/InvestigatorChat";
import { SARReports } from "./views/SARReports";
import { TransactionsView } from "./views/TransactionsView";
import { GraphView } from "./views/GraphView";

export type ViewKey = "dashboard" | "transactions" | "graph" | "upload" | "chat" | "sar";

export function AppShell() {
  const [view, setView] = useState<ViewKey>("dashboard");
  const [liveFeed, setLiveFeed] = useState(false);
  // Accounts an agent named in the chat, so "View on graph" lands on the right
  // part of the canvas instead of the whole network.
  const [graphFocus, setGraphFocus] = useState<string[]>([]);

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      <Sidebar view={view} onChange={setView} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar view={view} liveFeed={liveFeed} onToggleFeed={() => setLiveFeed((v) => !v)} />
        <main className="flex-1 min-w-0 overflow-auto">
          {view === "dashboard" && <CommandDashboard liveFeed={liveFeed} />}
          {view === "transactions" && <TransactionsView />}
          {view === "graph" && (
            <GraphView focusAccounts={graphFocus} onClearFocus={() => setGraphFocus([])} />
          )}
          {view === "upload" && <UploadView onDone={() => setView("dashboard")} />}
          {view === "chat" && (
            <InvestigatorChat
              onOpenGraph={(accounts) => {
                setGraphFocus(accounts);
                setView("graph");
              }}
            />
          )}
          {view === "sar" && <SARReports />}
        </main>
      </div>
    </div>
  );
}
