# Evals slice

Agent evals with Evalite. Read this before editing
[evals/copilot.eval.ts](../../evals/copilot.eval.ts).

## How it works

- Evalite files are `*.eval.ts`. `evalite(name, { data, task, scorers })` runs each
  `data` item through `task`, then scores the output. Storage is in-memory.
- `pnpm eval` runs once (CI); `pnpm eval:dev` watches + opens a local UI with a
  trace per case.
- The model is wrapped with `wrapAISDKModel`, which traces every LLM call and
  caches across runs. It works against the offline mock today; the day a real model
  is wired (`AI_PROVIDER`), these same evals exercise the real agent.
- `runCopilot(question, workspaceId, role)` runs `streamCopilot` and collapses the
  result into `{ text, toolNames, rows }` (rows flattened from every tool result).
  Existing deterministic scorers: `usedATool`, `returnedData`.

## Required evals — each MUST fail if its rule breaks

1. **Tenant isolation.** For each question, assert no returned row belongs to
   another workspace. Build trusted ground truth by calling the analytics functions
   directly with `{ workspaceId: "brightwave", role: "admin" }`, and assert every
   returned row's id/workspace is in that scoped set (and never a `meridian` id —
   seed ids are prefixed `bw-` vs `mer-`, which makes leaks easy to detect). The
   eval must FAIL if a query forgets `scopeWhere`.

2. **PII permissions.** Run the copilot as `analyst` (`role: "analyst"`) on a
   question that would surface candidates, and assert no tool result row contains a
   PII column (`name`, `email`, `phone`) or a PII-looking value (e.g. an
   `@`-bearing email, a `+1-555-…` phone). The eval must FAIL if an analyst ever
   receives PII. A companion positive case: `recruiter`/`admin` DO get those
   columns, proving gating is role-based, not a blanket drop.

3. **Answer quality (once a real model is wired).** Add an `expected` answer to
   `data` and score the agent's prose with an LLM-as-judge scorer from
   `evalite/scorers` (e.g. `answerCorrectness`). Deterministic scorers
   (`usedATool`, `returnedData`) stay as cheap guardrails.

## Notes

- Seed is deterministic ground truth (see [src/db/seed.ts](../../src/db/seed.ts)):
  Brightwave = 5 jobs / 18 candidates, Meridian = 4 jobs / 14 candidates, ids
  prefixed `bw-` / `mer-`. Use the analytics layer (not hardcoded numbers) as the
  oracle so evals survive seed tweaks.
- `ensureSeeded()` seeds only if the workspaces table is empty; keep it.
- Isolation and PII evals are deterministic and run against the mock today — wire
  them now so they guard every future change, before the real model lands.
