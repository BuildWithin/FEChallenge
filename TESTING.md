# Testing & verification

How to verify each layer of the copilot as it's built. This is a **living
document** — every commit that adds behavior should add the steps that prove it.
For the *why* behind design choices, see `DECISIONS.md`.

## Prerequisites

```bash
pnpm install
pnpm db:seed     # wipe + seed the two workspaces (Brightwave, Meridian Logistics)
```

The DB is file-backed PGlite at `./.pglite`, shared by the seed, dev server, and
tests. Reseed any time to get back to a known state.

## Commands at a glance

| Command | What it checks |
| --- | --- |
| `pnpm test` | The full vitest suite (unit + integration). |
| `pnpm exec vitest run <path>` | One test file. |
| `pnpm exec vitest watch <path>` | Re-run a file on save while building. |
| `pnpm typecheck` | `next typegen && tsc --noEmit` — types across the repo. |
| `pnpm eval` | Agent evals once (Evalite). |
| `pnpm eval:dev` | Evalite watch + local UI with per-case traces. |
| `pnpm dev` | App at http://localhost:3000 for manual checks. |

> Tests share one file-backed PGlite dir, so `vitest.config.ts` sets
> `fileParallelism: false` (worker processes must not open the same DB at once).

---

## The two hard requirements (must always pass)

These are the bugs we most need to never ship. They have dedicated assertions and
should stay green at every commit.

1. **Tenant isolation** — no query returns another workspace's rows.
2. **PII gating** — an `analyst` never receives candidate PII (name / email / phone).

---

## Layer 1 — Permissions + query layer ✅

**Code:** `src/db/permissions.ts`, `src/db/analytics.ts`
**Test:** `src/db/__tests__/analytics.test.ts`

```bash
pnpm exec vitest run src/db/__tests__/analytics.test.ts
```

What it proves:

- **Permissions policy** — `canReadPII` / `canReadColumn` allow non-PII columns and
  gate `candidates.name/email/phone` to non-analyst roles.
- **Tenant isolation** — candidate/job rows are prefixed `bw-` vs `mer-`, the two ID
  sets are disjoint, and a grouped aggregate total equals the row-level count for the
  *same* workspace (proving counts aren't computed globally).
- **PII gating by role** — admin & recruiter rows include `name/email/phone`; analyst
  rows do **not have those keys at all** (columns are absent, not blanked) — the
  guarantee that PII is unrepresentable for an analyst.
- **Filters stay scoped** — status/source filters never escape the workspace;
  stage / time-bucket / time-to-hire query shapes are sane.

Manual spot-check (optional): switch the **Role** dropdown to `analyst` in the UI and
confirm no PII appears; switch **Workspace** and confirm the numbers change.

---

## Layer 2 — Tool catalog ✅

**Code:** `src/agent/tools.ts`
**Test:** `src/agent/__tests__/tools.test.ts`

```bash
pnpm exec vitest run src/agent/__tests__/tools.test.ts
```

What it proves (by executing each tool the way the agent loop does — empty args):

- Every tool returns `{ rows, display }` with a valid `display.kind`
  (`bar`/`line`/`table`) and is drivable with no params (offline-mock safe).
- **PII holds at the tool boundary** — `listCandidates` as `analyst` returns rows with
  no `name/email/phone` keys; as `recruiter` it includes them.
- **Tenant scope holds at the tool boundary** — tool output for one workspace contains
  only that workspace's rows (`mer-` prefixes for Meridian).

Tools added: `applicationCountByStage`, `candidatesBySource`, `listJobs`,
`applicationsOverTime`, `timeToHire`, `listCandidates`.

## Layer 3 — Real model (Google Gemini) ✅

**Code:** `src/agent/provider.ts`, `src/agent/run.ts`, `src/env.ts`

Tests and evals stay on the offline **mock** for determinism — the real model is
opt-in via `AI_PROVIDER`. To verify the live agent:

```bash
# .env.local  (gitignored)
AI_PROVIDER=google
GOOGLE_GENERATIVE_AI_API_KEY=<free key from https://aistudio.google.com/apikey>

pnpm dev          # then ask: "How does my pipeline look by stage?"
```

Wiring is verified without a key by `getModel()`:
- `AI_PROVIDER=google` with no key → throws a friendly guard error.
- with a key → builds a `gemini-2.5-flash` model.

Loop hardening to confirm manually: analytics answers are stable (temperature 0),
the agent stops within 6 steps, and a tool error renders as an `output-error` part
instead of crashing the stream.

## Layer 4 — Generative UI ✅

**Code:** `src/app/artifacts.tsx`, `src/app/page.tsx`

Compile-checked by `pnpm build` (Next 16 / React 19 client bundle) and
`pnpm typecheck`. Manual click-path in `pnpm dev` (with the Gemini key set):

- "How does my pipeline look by stage?" → **bar** chart.
- "How have applications trended?" → **line** chart.
- "List the open jobs" / "Show me candidates" → **table** (as `admin`/`recruiter`,
  candidate PII columns appear; as `analyst`, they're gone).
- While a tool runs you see a **shimmer + "running"** chip; on completion the chart
  replaces it ("result"); a failing tool shows the **"error"** chip + message.

## Layer 5 — Agent evals ⏳ (stub only)

**Code:** `evals/copilot.eval.ts`
**Planned checks:** tenant-isolation eval (no foreign rows in any answer),
permission eval (`analyst` answers contain no PII), and — once a real model is wired —
answer-quality scoring.

---

## Conventions for adding to this doc

When a commit adds behavior:

1. Add/extend the test, keep `pnpm test` and `pnpm typecheck` green.
2. Flip the relevant layer above to ✅ and list exactly what the test proves.
3. If a guarantee can only be checked manually, write the click-path here.
