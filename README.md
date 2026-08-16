# FinGuard Intelligence

AI-assisted console for **cross-bank financial crime detection**: import transaction
CSVs, get automatic risk scoring and typology detection, explore the money flow as a
network graph, question a multi-agent analyst, and generate a filing-ready SAR.

Built with Next.js 14 (App Router), TypeScript, Tailwind CSS, and Firebase
(Auth + Firestore). Investigation answers are produced by a Groq-hosted model with a
deterministic local fallback, so the app still works with no API key.

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

Then open http://localhost:3000 and create an account.

### Environment

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_FIREBASE_*` | Firebase web config for your own project (Auth + Firestore enabled) |
| `GROQ_API_KEY` | Optional. Without it, investigations use the built-in offline engine |

`.env.local` is gitignored. Nothing in this repo carries a live project config.

## Views

1. **Command Dashboard** — KPI cards, hour × severity risk heatmap, agent fleet
   status, a scrolling alert feed grouped by day, and typology distribution.
2. **Transactions** — Searchable, severity-filtered ledger with per-row pattern tags.
3. **Transaction Graph** — SVG network canvas laid out as per-typology cluster cards,
   with zoom, focus-from-chat, an edge log, and a slide-over dossier per account.
4. **Upload CSV** — Drag-and-drop import with a pre-flight preview, plus a history
   tab that replays the analytics of any earlier upload or day.
5. **AI Investigator** — Natural-language chat over your own data. Findings are
   grounded in a locally computed evidence brief, with a jump-to-graph action.
6. **Compliance / SAR** — Generates a SAR narrative from that same evidence and
   exports a clean A4 document via a print-only portal.

## Structure

```
src/
  app/                 App Router (layout, page, login, api/chat)
  components/          AppShell, Sidebar, TopBar, NodeDetailDrawer, views/*, ui/*
  lib/firebase.ts      Firebase client init from env
  lib/hooks.ts         Firestore reads/writes, CSV bulk insert, upload history
  lib/investigation.ts Evidence engine: pattern detectors, per-account stats, SAR text
  lib/mockData.ts      Types, formatters, risk classification, pattern taxonomy
```

Per-user data lives under `users/{uid}/{transactions,alerts,sar_reports,uploads}`,
so accounts never see each other's imports.
