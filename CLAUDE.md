# ATS Analytics Copilot

A multi-tenant ATS analytics copilot. An AI agent answers questions about ONE
workspace's recruiting data (jobs, candidates, applications) by calling tools and
rendering charts/tables. The repo boots on a deterministic mock model; we build the
copilot against a real model.

## Non-negotiable rules (these drive every decision)

- **Tenant isolation by construction.** Every read is scoped to `ctx.workspaceId`.
  Workspace A must never see workspace B's rows. This is true BY CONSTRUCTION, not
  by remembering to filter: reuse `scopeWhere` and keep `ctx` as the first argument
  of every query so a query cannot be written without a scope.
- **PII gating by construction.** Candidate PII is `name`, `email`, `phone`. An
  `analyst` must NEVER receive it; `recruiter` and `admin` may. Enforce at the
  projection level so an analyst's return TYPE does not include PII columns — a PII
  leak for the wrong role should be unrepresentable, not merely rejected at runtime.
- **The agent never writes SQL.** It picks tools and passes high-level params.
- **Every tool returns `{ rows, display }`** where `display.kind` is `bar`, `line`,
  or `table`. The tool decides the display, not the model.
- Review every diff against these rules. Never commit code you do not understand.

## Commands

```bash
pnpm install
pnpm db:seed      # wipe + seed the two workspaces (Brightwave, Meridian Logistics)
pnpm dev          # http://localhost:3000
pnpm eval         # run agent evals once (Evalite)
pnpm eval:dev     # Evalite watch + local UI
pnpm typecheck
pnpm test         # vitest
pnpm build
```

## Slices

Read the relevant slice before working in that area. Each doc is a spec + rules.

- [docs/slices/architecture.md](docs/slices/architecture.md) — the layer chain
  (context → analytics → tools → artifact → UI → eval), each layer's
  responsibility, the `scopeWhere` pattern, and the PII-by-construction approach.
  Includes the repo layout and where to start.
- [docs/slices/tools.md](docs/slices/tools.md) — the tool catalog, input schemas,
  enum values, the `{ rows, display }` contract, and join/semantics notes.
- [docs/slices/ui.md](docs/slices/ui.md) — generative UI plan: hand-rolled SVG
  bar/line + a table renderer, keyed off `display.kind`, rendered while streaming.
- [docs/slices/evals.md](docs/slices/evals.md) — required evals (tenant isolation,
  PII, answer quality), each of which must FAIL if its rule is broken.
- [docs/slices/model.md](docs/slices/model.md) — OpenRouter wiring, loop control,
  and tool-error handling.
