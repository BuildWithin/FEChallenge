# Decisions

## Overview

An ATS analytics copilot scoped to one workspace and role at a time. Built
**bottom-up**, so the two hard requirements (tenant isolation, PII gating) are
locked in at the lowest layer before anything above can violate them.

Build order and state:

1. **Permissions + query layer** — ✅ done. Scoped query layer with role-gated PII,
   covered by tests.
2. **Tool catalog** (`src/agent/tools.ts`) — ⏳ next. Wrap each query as a tool with
   an LLM-fillable input schema and a `{ rows, display }` return.
3. **Real model/agent** (`src/agent/provider.ts`) — ⏳ planned. Wire a real provider;
   review loop control and tool-error handling.
4. **Generative UI** (`src/app/page.tsx`) — ⏳ planned. Render `bar`/`line`/`table`
   from the display hint, with streaming and empty/error states.
5. **Evals** (`evals/copilot.eval.ts`) — ⏳ planned. Tenant-isolation, permission, and
   (once a model is wired) answer-quality scorers.

Verification steps per layer live in `TESTING.md`.

## Architecture & key decisions

- **Tenant scoping** — every query goes through one `scopeWhere` helper that AND-s in
  the workspace filter, and `ctx` is the **first argument** of every query function,
  so a query can't even be expressed without its tenant scope. This is the "can't
  forget it" property as the layer grows.
- **Permissions (PII)** — enforced in the query layer, not after the fact. A single
  `candidateColumns(role)` selector adds the PII columns (name/email/phone) to the
  projection **only** when the role permits. For an `analyst` the executed SQL never
  references those columns, so a leak is *unrepresentable* rather than filtered.
  `src/db/permissions.ts` holds the policy (`canReadPII`); the query layer enforces it.
- **Query layer** — small composable functions (`applicationCountByStage`,
  `candidatesBySource`, `listJobs`, `applicationsOverTime`, `timeToHire`,
  `listCandidates`) returning plain rows; display hints live at the tool layer, not
  here. All inputs are optional (see Trade-offs).
- **Tool catalog** — _planned (layer 2)._
- **Generative UI** — _planned (layer 4)._

## Model & agent

_Planned (layer 3)._ Boots on the offline mock today; the real provider choice and
loop notes (multi-step control, tool-error handling, stop strategy) go here once
wired.

## Benchmarks

`src/db/__tests__/analytics.test.ts` asserts the two hard requirements directly:

- **Tenant isolation** — candidate/job rows are prefixed `bw-` vs `mer-`, the two ID
  sets are disjoint, and grouped aggregate totals equal the row-level count for the
  *same* workspace (counts aren't global).
- **PII gating** — admin/recruiter rows carry `name/email/phone`; analyst rows do not
  have those keys at all (absent, not blanked).

Agent-level evals (asserting the same through the tool boundary) are planned.

## Trade-offs & cuts

- **Optional-only tool inputs** — the offline mock calls tools with empty args, so
  every query param is optional. Keeps boot/tests deterministic; the cost is the mock
  can't exercise filtered paths (a real model can).
- **`fileParallelism: false`** — tests share one file-backed PGlite dir; serializing
  test files avoids two worker processes opening the same DB.
- **Phased build** — model, tools, UI, and evals are deliberately not started yet;
  the foundation is finished and verified first.

## Working with the agent

- **Delegated:** the scoped query layer, the PII chokepoint design, and the test
  harness.
- **Caught:** a PGlite/Drizzle bug where a parameterized `date_trunc` bucket produced
  mismatched binds across SELECT/GROUP BY — fixed by whitelisting and inlining the
  bucket as raw text.
- **Never delegate unsupervised:** the tenant/PII enforcement strategy and commit
  messages — reviewed before they land.

## Hours

_TBD._
