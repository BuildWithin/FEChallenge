# Decisions

## Overview

An ATS analytics copilot scoped to one workspace and role at a time. Built
**bottom-up**, so the two hard requirements (tenant isolation, PII gating) are
locked in at the lowest layer before anything above can violate them.

Build order and state:

1. **Permissions + query layer** — ✅ done. Scoped query layer with role-gated PII,
   covered by tests.
2. **Tool catalog** (`src/agent/tools.ts`) — ✅ done. Six tools wrap the query layer,
   each with an LLM-fillable input schema and a `{ rows, display }` return.
3. **Real model/agent** (`src/agent/provider.ts`) — ✅ done. Wired Google Gemini
   (free tier) and hardened the loop.
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
- **Tool catalog** — six thin tools over the query layer
  (`applicationCountByStage`, `candidatesBySource`, `listJobs`,
  `applicationsOverTime`, `timeToHire`, `listCandidates`). Inputs are all optional
  with enums + descriptions so a real model fills them well and the offline mock
  (empty args) still drives them. `ctx` is threaded in, so tenant/PII guarantees hold
  at the tool boundary — `src/agent/__tests__/tools.test.ts` proves it by executing
  the tools directly.
- **Generative UI** — _planned (layer 4)._

## Model & agent

- **Provider — Google Gemini (`gemini-2.5-flash`), free tier.** Chosen because it
  needs no billing to run (free key from Google AI Studio), is fast, and tool-calls
  well — so a reviewer can run the real agent with zero cost. Added as a `google`
  case in `src/agent/provider.ts` alongside anthropic/openai/bedrock; the same
  `baseURL` gateway passthrough applies. Switching providers is a one-line env
  change, and `gemini-2.5-pro` (paid) is a drop-in upgrade via `GOOGLE_MODEL`.
- **Mock stays the default.** No key needed to boot or to run tests/evals; only a
  real `AI_PROVIDER` flips to the live model. Tests force `mock` for determinism.
- **Loop control** (`src/agent/run.ts`): `temperature: 0` for reproducible analytics;
  `stopWhen: stepCountIs(6)` to bound the orient→query→answer loop (the model also
  stops naturally on a tool-free closing message); `onError` logs stream-level
  failures. A throwing tool surfaces as a tool-error part the model can recover from
  and the UI renders, rather than killing the stream.

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
