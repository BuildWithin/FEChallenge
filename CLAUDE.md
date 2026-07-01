# Agent orientation — ATS Analytics Copilot

Working notes for **you and your AI coding agent**. This repo is a completed
take-home slice: multi-tenant ATS analytics copilot with scoped tools, Evalite
benchmarks, and generative UI. Trade-offs and reasoning live in **`DECISIONS.md`**.

> **Cursor users:** day-to-day agent rules are in **`.cursorrules`** at the repo
> root (committed per the brief). This file stays the shared orientation for
> Claude Code and other agents.

## The one rule that matters most

**All data access is scoped to the caller's workspace AND role.**

- Every read: `ctx.workspaceId` via `scopeWhere` in `src/db/analytics.ts`.
- Candidate PII (name / email / phone): gated by `candidateColumns(role)` — an
  `analyst` must never SELECT those columns. A cross-workspace or PII leak is the
  worst bug you can ship.

Extend the query layer using the reference pattern in `applicationCountByStage`;
mirror how tRPC passes `ctx` from headers.

## What is implemented (do not re-stub)

| Area | Status |
| --- | --- |
| `src/db/permissions.ts` | PII by construction |
| `src/db/analytics.ts` | Seven scoped queries + `scopeWhere` |
| `src/agent/tools.ts` | Seven tools → `{ rows, display }` |
| `src/agent/provider.ts` | `buildSystemPrompt({ workspaceId, role })` + real providers |
| `src/app/page.tsx` | `display`-driven charts/tables + role-aware UX |
| `evals/copilot.eval.ts` | 11 Evalite cases (isolation + permissions) |
| `DECISIONS.md` | Deliverable write-up |

**Mock vs real model:** `AI_PROVIDER=mock` (default) for boot/CI/evals. Set
`AI_PROVIDER=openai` (or anthropic/bedrock) in `.env.local` for demos — see
`.env.example`.

## Repo layout

```
src/
  db/        schema · PGlite · seed · analytics.ts · permissions.ts
  server/    tRPC router + context (workspaceId + role from headers)
  agent/     tools.ts · run.ts · provider.ts · mock-model.ts · artifact.ts
  app/       chat UI · /api/chat · /api/trpc
evals/       Evalite *.eval.ts
docs/        supplementary phase guides + roadmap (optional reading)
```

## Commands

```bash
pnpm install
pnpm db:seed      # Brightwave + Meridian Logistics
pnpm dev          # http://localhost:3000
pnpm eval         # Evalite (mock)
pnpm test         # vitest — tests under src/**/__tests__/
pnpm typecheck
pnpm build
```

## When you change things

- **New query:** `ctx` first, `scopeWhere`, `candidateColumns` for candidate rows.
- **New tool:** optional inputs (mock), return `{ rows, display }` with a known `kind`.
- **UI:** dispatch on `display.kind` in `page.tsx` — avoid per-tool components.
- **Prompt:** keep TOOL CATALOG / KNOWN LIMITATIONS in sync with tools; see
  `docs/roadmap.md` when adding capabilities.
- **Tests:** colocate under `src/**/__tests__/`, not a top-level `tests/` folder.

## Using AI tools on this repo

Use agents freely; **own security and scoping**. See **“Working with the agent”**
in `DECISIONS.md` for what we delegated vs what we reviewed by hand.
