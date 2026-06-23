# Spec 01 — Scoped query layer  **[HARD REQUIREMENT]**

**Status:** Done · **Depends on:** — · **Estimate:** ~75m (largest spec)

## Goal
Tenant scoping and PII gating are enforced *by construction* in the query layer — a
cross-workspace read or an analyst-PII read is unrepresentable, not rejected after the fact.

## Contract
All new query fns are **ctx-first** (mirror the reference `applicationCountByStage`) and route
every WHERE through the existing `scopeWhere`. Candidate columns are projected through one
helper only.

```ts
// src/db/permissions.ts
// false iff `column` is PII for `table` AND role === "analyst"; true otherwise.
function canReadColumn(role: Role, table: string, column: string): boolean

// src/db/analytics.ts
// The ONLY place candidate columns are selected. Always includes id/source/createdAt;
// includes name/email/phone only when canReadColumn allows for ctx.role.
function candidateSelection(ctx: AnalyticsCtx): Record<string, AnyColumn>

function candidatesBySource(ctx: AnalyticsCtx):
  Promise<{ source: string; count: number }[]>

function jobsOverview(ctx: AnalyticsCtx):
  Promise<{ id: string; title: string; department: string; status: string; applications: number }[]>

// PII-bearing. Returned columns vary by role via candidateSelection (analyst rows omit
// name/email/phone keys entirely). Filters are optional and composable via scopeWhere extras.
function listCandidates(
  ctx: AnalyticsCtx,
  opts?: { source?: string; stage?: string; jobId?: string; limit?: number },
): Promise<Row[]>
```

**Invariant:** every fn here is unusable without `ctx`, and no candidate row can carry a PII
key the role may not read — because the column is never selected, not stripped afterward.

## In scope
- Implement `canReadColumn` (replace the permissive stub).
- Add `candidateSelection` + the three query fns above.
- `src/db/analytics.test.ts` (vitest) — the acceptance below.

## Out of scope
Tool wiring (Spec 02), UI, agent prompt. No new schema/migrations.

## Acceptance (`pnpm test`, calling fns directly — no model)
- [x] **Tenant:** with `{ workspaceId: "brightwave" }` every fn returns zero `mer-*` rows;
      with `{ workspaceId: "meridian" }` zero `bw-*` rows. (Seeded counts: 18 vs 14 candidates.)
- [x] **PII hidden:** `listCandidates` as `analyst` → rows have **no** `name`/`email`/`phone`
      keys.
- [x] **PII shown:** same call as `recruiter` and `admin` → those keys are present.
- [x] **Regression catch:** reverting `candidateSelection` (re-adding PII for analyst) turns 2
      tests red; dropping the workspace filter in `scopeWhere` turns 5 red. Both verified, then
      reverted.

## Files
`src/db/permissions.ts`, `src/db/analytics.ts`, `src/db/analytics.test.ts` (new)

> Sizing note: this is the heaviest spec. If it runs long, the aggregate queries
> (`candidatesBySource`, `jobsOverview`) can slip to a follow-up commit — but `canReadColumn`
> + `candidateSelection` + `listCandidates` + their tests are the hard-requirement core and
> ship together.
