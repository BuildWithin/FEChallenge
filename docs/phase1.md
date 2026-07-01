# Phase 1 — Security core: tenant scoping + PII enforcement

> Build guide for the highest-weighted work. Everything else is built on top of
> this layer, so it goes first. Guiding principle: **right by construction** — a
> cross-workspace read or an analyst-visible PII column should be hard or
> impossible to even express, not merely rejected after the fact.

**Where it fits:** Phase 1 of [docs/implementationPlan.md](implementationPlan.md).

## Git workflow

| Item | Value |
| --- | --- |
| **Branch** | `feature/security-tenant` |
| **Focus** | Database tenant isolation + role-based PII permissions |
| **Base** | `main` |
| **PR target** | `main` |
| **Opens after** | — (first phase) |

**Workflow:** create the branch from `main`, implement this phase, open a PR to `main`.
Do not stack later phases on this branch — each phase gets its own branch and PR.

**Acceptance (both hard requirements):**
- A query called with `{ workspaceId: "brightwave" }` never returns Meridian rows.
- A query called with `{ role: "analyst" }` never returns candidate PII columns
  (`name` / `email` / `phone`).

---

## Files touched

| File | Change |
| --- | --- |
| [src/db/permissions.ts](../src/db/permissions.ts) | Implement real `canReadColumn`; add `candidateColumns(role)` safe select-map helper; add `assertCanReadPII` guard. |
| [src/db/analytics.ts](../src/db/analytics.ts) | Keep `scopeWhere` as the single scoping funnel; document/formalize the `ctx`-first discipline. (No new analytics fns yet — those land in Phase 2.) |

No tool, UI, or tRPC changes in this phase. Keep the blast radius tiny so the
security layer is reviewable on its own commit.

---

## Design decisions (why)

1. **PII enforcement lives in the query layer, not the tool or UI.** If a tool or
   the UI were responsible for stripping PII, every new tool would have to
   remember to do it. Instead the query decides *which columns exist* based on
   `ctx.role`. An analyst literally never receives a `name` column to leak.
2. **A safe column set, not post-filtering.** We don't fetch PII then delete keys
   (that still pulls PII into process memory and is easy to forget). We build the
   Drizzle `select({...})` map from the role, so PII columns are never selected
   for an analyst. This is what makes the leak *unrepresentable*.
3. **One scoping funnel.** `scopeWhere` already AND-s the workspace filter into
   every query and can't return `undefined`. We keep every read going through it
   and put `ctx` first in every fn signature so a query can't be written without
   its tenant scope.
4. **Defense in depth.** `canReadColumn` + `assertCanReadPII` give a cheap runtime
   guard for the rare case a caller hand-builds a select map, so an accidental PII
   selection throws loudly in tests/evals rather than leaking silently.

---

## Step 1 — `src/db/permissions.ts`

Current state: roles + `PII_COLUMNS` are defined, but `canReadColumn` is a
permissive stub that returns `true` for everyone (see
[src/db/permissions.ts](../src/db/permissions.ts) lines 36-38).

### 1a. Implement real `canReadColumn`

```ts
/** Whether `role` may read `table.column`. Analyst is denied PII; others allowed. */
export function canReadColumn(role: Role, table: string, column: string): boolean {
  const pii = PII_COLUMNS[table];
  if (pii?.includes(column) && role === "analyst") return false;
  return true;
}
```

Rationale: today only `analyst` is restricted and only `candidates` has PII, but
keying off `PII_COLUMNS` means adding a new PII table/column automatically extends
enforcement — no code change here.

### 1b. Add a role-aware safe column set for candidates

This is the core of "unrepresentable". Callers ask for the candidate columns they
want; the helper returns a Drizzle select map with PII omitted for analysts.

```ts
import { candidates } from "./schema";

/** Non-PII candidate columns every role may read. */
const CANDIDATE_PUBLIC_COLUMNS = {
  id: candidates.id,
  workspaceId: candidates.workspaceId,
  source: candidates.source,
  createdAt: candidates.createdAt,
} as const;

/** PII candidate columns — only recruiter/admin. */
const CANDIDATE_PII_COLUMNS = {
  name: candidates.name,
  email: candidates.email,
  phone: candidates.phone,
} as const;

/**
 * The candidate column set a role may select. Analyst gets public columns only;
 * recruiter/admin also get PII. Feed the return value straight into
 * `db.select(candidateColumns(role))` so PII is never even selected for analyst.
 */
export function candidateColumns(role: Role) {
  return role === "analyst"
    ? CANDIDATE_PUBLIC_COLUMNS
    : { ...CANDIDATE_PUBLIC_COLUMNS, ...CANDIDATE_PII_COLUMNS };
}
```

Note: the return type is a union of the two shapes. Downstream tools/UI should
treat PII fields as optional (`row.name?`), which is correct — they may be absent
by design.

### 1c. Runtime guard (defense in depth)

```ts
/** Throw if `role` is asked to read a PII column it may not see. */
export function assertCanReadPII(role: Role, table: string, columns: string[]): void {
  const denied = columns.filter((c) => !canReadColumn(role, table, c));
  if (denied.length > 0) {
    throw new Error(
      `Role "${role}" may not read PII columns on ${table}: ${denied.join(", ")}`,
    );
  }
}
```

This is a belt-and-suspenders check for any query that builds a select map by
hand instead of via `candidateColumns`. In the happy path (`candidateColumns`),
it's never triggered.

---

## Step 2 — `src/db/analytics.ts`

Current state: `scopeWhere` + the reference `applicationCountByStage` already model
the pattern (see [src/db/analytics.ts](../src/db/analytics.ts)). Phase 1 only
formalizes the discipline; the new query fns arrive in Phase 2.

### 2a. Keep `scopeWhere` as the only scoping path

Leave `scopeWhere` as-is — it's already correct and non-optional:

```ts
function scopeWhere(
  table: { workspaceId: AnyColumn },
  ctx: AnalyticsCtx,
  extra: Array<SQL | undefined> = [],
): SQL {
  const parts = [eq(table.workspaceId, ctx.workspaceId), ...extra].filter(
    (p): p is SQL => p !== undefined,
  );
  return and(...parts)!; // always has ≥1 part → never undefined
}
```

### 2b. Formalize the `ctx`-first rule (convention + comment)

Every analytics fn must take `ctx: AnalyticsCtx` as its **first** parameter and
call `scopeWhere` in its `where`. Add a short doc block at the top of the file
stating the two invariants so reviewers and future queries can't miss them:

```ts
/**
 * INVARIANTS for every function in this file:
 *  1. `ctx: AnalyticsCtx` is the FIRST parameter — a query can't be written
 *     without its tenant scope.
 *  2. The `.where(...)` clause goes through `scopeWhere(table, ctx, extra)` —
 *     the one place the workspace filter is applied.
 *  3. Any candidate read selects columns via `candidateColumns(ctx.role)` so PII
 *     is gated by construction (see src/db/permissions.ts).
 */
```

We deliberately do **not** over-engineer a generic `scopedSelect` wrapper now —
`scopeWhere` + the invariant comment already make scope hard to forget, and a
premature abstraction would cost time. Revisit if the layer grows large (note in
`DECISIONS.md`).

---

## Verification

No new user-facing surface yet, so verify with a throwaway script or a quick unit
check (do not commit the scratch file). Reseed first so data exists.

```bash
pnpm db:seed
pnpm typecheck
```

Direct-call proof (scratch, e.g. `tsx`):

```ts
import { db } from "@/db/client";
import { candidates } from "@/db/schema";
import { candidateColumns } from "@/db/permissions";
import { eq } from "drizzle-orm";

// 1. Tenant isolation: Brightwave ctx must never see Meridian rows.
const bw = await db
  .select(candidateColumns("admin"))
  .from(candidates)
  .where(eq(candidates.workspaceId, "brightwave"));
console.assert(bw.every((r) => r.workspaceId === "brightwave"), "tenant leak!");

// 2. Permissions: analyst select map has no PII keys.
const analystRow = (await db.select(candidateColumns("analyst")).from(candidates).limit(1))[0];
console.assert(!("name" in analystRow) && !("email" in analystRow) && !("phone" in analystRow), "PII leak!");

// 3. Guard fires for a bad hand-built read.
// assertCanReadPII("analyst", "candidates", ["name"]) → throws
```

What to assert:
- Every returned candidate row has `workspaceId === ctx.workspaceId`.
- `candidateColumns("analyst")` produces rows with **no** `name`/`email`/`phone`.
- `assertCanReadPII("analyst", "candidates", ["name"])` throws.

> The real, committed proof of these lands in Phase 3 as evals. This scratch check
> is just to de-risk before moving on.

---

## Definition of done

- [ ] `canReadColumn` denies PII to `analyst`, allows others (keyed off `PII_COLUMNS`).
- [ ] `candidateColumns(role)` returns a role-safe Drizzle select map (no PII for analyst).
- [ ] `assertCanReadPII` throws on a denied PII read.
- [ ] `analytics.ts` documents the three invariants; `scopeWhere` unchanged and still the only scoping path.
- [ ] `pnpm typecheck` green.
- [ ] Scratch verification passes (then deleted — not committed).

---

## Phase commit message

```
feat(security): enforce tenant scoping + PII by construction
```

**PR title (suggested):** `feat(security): tenant isolation + PII enforcement by construction`

**Branch:** `feature/security-tenant` → `main`
