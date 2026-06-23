# Specs — ATS Analytics Copilot

Spec-Driven Development. Each spec is a small, sequenced slice with a **testable
acceptance bar**. Build them in order; the hard requirement (Spec 01) comes first so
tenant + PII correctness is provable before anything is layered on top.

> **Execution order:** `00 → 01 → 02 → 04 → 03 → 05`. The file numbers are stable, but
> **Spec 04 (benchmarks) runs before Spec 03 (UI)**: prove the agent can't be talked into a
> tenant/PII leak before investing in the generative UI. Both depend only on Spec 02, so the
> swap is clean.

Each spec carries a header (**Status · Depends on · Estimate**) then
**Goal → Contract → In scope → Out of scope → Acceptance → Files**. The *Contract* section
pins signatures/types so nothing is re-decided at implementation time.

| #  | Spec | Why it's here |
|----|------|---------------|
| 00 | [Real OpenAI agent](./00-real-agent.md) | Swap the mock for a real model + a system prompt that drives tools well. |
| 01 | [Scoped query layer](./01-scoped-query-layer.md) **[HARD REQ]** | Tenant + PII enforced *by construction*. The non-negotiable. |
| 02 | [Tool catalog](./02-tool-catalog.md) | A clean tool surface an LLM can drive; includes the PII-bearing tool. |
| 03 | [Generative UI](./03-generative-ui.md) | Tool results → real streaming charts/tables. |
| 04 | [Benchmarks](./04-benchmarks.md) | Adversarial evals that catch tenant/PII leaks. |
| 05 | [Applications over time](./05-applications-over-time.md) *(optional)* | The one tool that justifies the `line` display. |

## Design decisions (locked)

- **No "tool library" abstraction.** The value lives one layer down: a **scoped query
  catalog** where tenant + PII are enforced by construction. Tools stay a thin
  declarative map over it.
- **PII gate = role-aware projection**, not post-query redaction. An analyst's query
  never SELECTs `name/email/phone` — the leak is *unrepresentable*, mirroring `scopeWhere`.
- **Proof split:** deterministic enforcement → vitest unit tests; fuzzy agent behavior →
  adversarial Evalite evals.
- **Model:** OpenAI `gpt-4o-mini`.

## The two chokepoints (the whole "by construction" story)

1. `scopeWhere(table, ctx, extra)` — the only WHERE builder; always AND-s the workspace filter.
2. `candidateSelection(ctx)` — the only place candidate columns are selected; omits PII
   when `canReadColumn(ctx.role, "candidates", col)` is false.

Discipline that makes it stick: **tools import from `analytics.ts` only, never `db`.**

## Cut-line

If the time box closes early: drop Spec 05, trim Spec 03 polish — but **keep Spec 04**.
The 2-hour checkpoint is Spec 00 + Spec 01 + unit tests: hard requirements proven against
a real agent.
