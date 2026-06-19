# Tools slice

The copilot's tool catalog. Read this before editing
[src/agent/tools.ts](../../src/agent/tools.ts) or the analytics functions behind it.

## Contract (applies to every tool)

- Built by `buildTools(ctx)`, which closes over `ctx = { workspaceId, role }`.
- `workspaceId` and `role` are **never** tool inputs — they come from `ctx`.
- Every input is **optional with a sane default**, so a model can call the tool
  with `{}`. (The boot mock calls tools with EMPTY args — a tool that requires an
  arg breaks offline boot/tests. See the model slice.)
- Filters are **closed enums**, never free strings.
- Each tool returns `{ rows, display }` (see
  [src/agent/artifact.ts](../../src/agent/artifact.ts)). **The tool decides the
  display**, not the model.
- The tool calls an analytics function with `ctx` first; it never writes SQL.

`display` is one of:
- `{ kind: "table"; columns: string[] }`
- `{ kind: "bar"; x: string; y: string; title: string }`
- `{ kind: "line"; x: string; y: string; title: string }`

## Schema facts (source of truth: [src/db/schema.ts](../../src/db/schema.ts))

- `workspaces(id, slug, name)`
- `users(id, workspaceId, name, email, role)` — role: `admin | recruiter | analyst`
- `jobs(id, workspaceId, title, department, location, status, createdAt)` —
  status: `open | closed | draft`
- `candidates(id, workspaceId, name[PII], email[PII], phone[PII], source, createdAt)`
  — source: `referral | linkedin | job_board | agency | careers_site`
- `applications(id, workspaceId, candidateId, jobId, stage, appliedAt, updatedAt)`
  — stage: `applied | screen | interview | offer | hired | rejected`

Note: **`source` lives on `candidates`; `stage` lives on `applications`.** Reading
`source` for an application means joining applications → candidates.

## Catalog

### 0. `applicationCountByStage` (reference, already shipped)

Count applications grouped by pipeline stage. Input `{ jobId?: string }`.
Display: `bar` (x: `stage`, y: `count`). Keep as-is — it's the template.

### 1. `listCandidates` — display: `table`

The PII-gating demo tool. Returns candidates for this workspace, projected by role
(analyst gets no `name`/`email`/`phone`).

- Inputs (all optional): `{ stage?, source?, jobId?, limit? }`, `limit` default 20.
- `stage` and `source` are closed enums (values above).
- Filtering by `stage` means "candidates with at least one application at that
  stage" → join through `applications`.
- `jobId` filters to candidates who applied to that job (join through
  `applications`).
- Tenant scope applies to candidates AND the applications joined.

### 2. `jobsOverview` — display: `table`

Jobs with their application counts broken down by stage.

- Input (optional): `{ status? }` enum (`open | closed | draft`).
- Surfaces job `id` + `title` so the model can translate a job title → `jobId` for
  the other tools. This is a deliberate **multi-step path** (ask jobs, then filter
  another tool by the returned id).

### 3. `applicationsOverTime` — display: `line`

Application volume over time.

- Inputs: `{ granularity, dateRange?, jobId? }`. `granularity` is `day | week |
  month`, **default `week`** so the tool is callable with no args.
- `dateRange` is `{ from?, to? }` as ISO date strings.
- `jobId` scopes to one job.

### 4. `applicationsBySource` — display: `bar`

Applications grouped by candidate source.

- Inputs (both optional): `{ dateRange?, jobId? }`.
- Joins `applications` → `candidates` to read `source` (source is NOT on
  applications).

## Multi-step path worth preserving

`jobsOverview` returns `{ id, title }`, and `listCandidates` /
`applicationsOverTime` / `applicationsBySource` accept `jobId`. So "show candidates
for the Senior Software Engineer role" is a two-call plan: resolve the title to an
id, then filter. Keep ids in `jobsOverview` output for this reason.
