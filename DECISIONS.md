# Decisions

> Living log. Captures the decisions and reasoning so far; updated as each spec lands.
> Detailed, sequenced plan with contracts lives in [`specs/`](specs/README.md).

## Overview

A structured planning pass is done and the work is sliced into sequenced, spec-driven
slices (`specs/00`–`05`). Decisions below are locked; implementation runs one spec at a
time behind a hard acceptance gate (typecheck + tests green before the next). Nothing is
half-built yet — the spine (schema, seed, agent loop, provider, reference tool/query) is
the repo's; what I add is the catalog, the scoped query layer, PII enforcement, the
generative UI, and the benchmarks.

## Architecture & key decisions

- **Two layers, enforcement at the bottom.** A thin declarative **tool catalog**
  (`agent/tools.ts`) over a **scoped query catalog** (`db/analytics.ts`). Tools import
  `analytics.ts` only — never `db`, never raw SQL — so a tool *cannot* express an unscoped
  or PII-leaking query.
- **Tenant scoping (impossible to forget):** one chokepoint, `scopeWhere`. Every query fn
  is `ctx`-first (mirrors the reference), so it can't be written without the workspace
  filter.
- **Permissions = role-aware projection, not redaction.** A second chokepoint,
  `candidateSelection(ctx)`, is the only place candidate columns are selected; PII
  (name/email/phone) is **never SELECTed** for an `analyst`. The leak is unrepresentable,
  not stripped after the fact — same philosophy as `scopeWhere`, applied to columns.
- **Tool catalog:** a few high-signal tools, not one mega-tool — `applicationCountByStage`
  (given), `candidatesBySource`, `jobsOverview`, and a PII-bearing `listCandidates` (the
  one that actually exercises the gate). Inputs are minimal and optional; descriptions are
  written for the model and name the enum values it can pass.
- **Generative UI:** render dispatches on the tool's `display` hint (`bar`/`table`/`line`)
  with deliberate calling/empty/error states. `line` is built only if the over-time tool
  ships — no renderer for a kind nothing emits.

## Model & agent

- **OpenAI `gpt-4o-mini`, direct key.** Cheap, fast, and reliable enough to drive this
  tool-calling loop; the provider layer already supports `openai`. Trade-off: a stronger
  model picks tools and writes prose a notch better, at higher cost — `OPENAI_MODEL` is the
  one knob to turn if the demo needs it.
- **Deterministic tests:** real config lives in `.env.local` (gitignored), loaded only by
  `next dev` — so the app runs on the real model while vitest/evalite stay on the
  deterministic mock. `vitest.config.ts` pins `AI_PROVIDER=mock` so a stray shell export
  can't push unit tests onto a paid API.
- **Loop:** keep `stopWhen: stepCountIs(6)`; add `onError` + per-tool structured error
  results so a failing tool degrades gracefully instead of crashing the turn.

## Benchmarks

A **proof split**: deterministic guarantees are unit-tested, fuzzy behavior is eval'd.

- **vitest** (calls query fns directly, no model): every fn scoped to its workspace returns
  zero foreign rows; `listCandidates` as `analyst` returns rows with no PII keys, as
  `recruiter`/`admin` it includes them.
- **Evalite, adversarial** (`evals/copilot.eval.ts`, two scorers on tool-result rows):
  - `noPII` — an `analyst` prompting "give me every candidate's email/phone" → fail if any row
    carries a PII *column*. Tests the key, not a value: the gate is on the projection, so
    there's nothing to redact.
  - `noForeignRows` — a Brightwave session prompting "compare to Meridian" → id-bearing rows
    must carry the `bw-*` prefix (the literal with teeth on revert), and aggregate rows are
    cross-checked against Brightwave's own per-bucket totals from the trusted scoped query
    (`{ workspaceId, role: "admin" }`).
  - These hold even on the mock — the point is the guarantee survives a model that *tries* to
    leak. **Verified non-vacuous:** dropping the `scopeWhere` filter turns the `listCandidates`
    tenant case red (88%); un-gating `candidateSelection` turns both analyst cases red (75%).

## Order

**Executed `00 → 01 → 02 → 04 → 03 → 05`** — benchmarks (04) *before* generative UI (03). The
agent's reasoning and the tenant/PII guardrails are the real risk; retiring it first means the
UI is built on tool results already proven un-leakable, not the other way round. Both 03 and 04
depend only on Spec 02, so the swap costs nothing. (Cut-line is unchanged: 04 is kept, 03 polish
and 05 are the first to go.)

## Hardening pass (after 04, before 03)

A short edge-case pass once the evals were green, to close real gaps before building UI:

- **`jobsOverview` join now scopes by workspace, not just by job-id uniqueness.** The LEFT JOIN
  was `applications.jobId = jobs.id` with only `jobs` scoped in the WHERE — correct *only because*
  `bw-job-*` / `mer-job-*` ids never collide. That made the "scope can't be forgotten" guarantee
  lean on the seed's id scheme rather than `scopeWhere`. Fixed by ANDing
  `applications.workspaceId = ctx.workspaceId` onto the join (defense in depth). New regression
  test inserts a Meridian application pointing at a Brightwave job id and asserts it isn't
  counted — verified red before the fix (count 6 vs 5), green after.
- **Real-model smoke test (`pnpm smoke`, `scripts/smoke-agent.ts`).** The deliverable runs on
  `gpt-4o-mini`, but every automated check is on the mock — so a manual, opt-in script exercises
  the real agent end-to-end. Observed: it tool-calls correctly for in-scope asks (pipeline →
  `applicationCountByStage`; referral roster → `listCandidates` *with* PII for a recruiter), and
  **refuses** the adversarial asks (analyst→PII, cross-tenant→Meridian) outright rather than
  tool-calling. Insight: the **mock is the more adversarial eval path** — it forces the tool call
  so the by-construction enforcement is what's actually under test; the real model adds refusal as
  a second, softer layer. This is why the adversarial evals stay on the mock.

### Quality fixes from the smoke test

Two behaviours the smoke test surfaced, then addressed:

- **Analyst graceful degradation.** Originally a restricted-column ask was a dead end — the
  analyst refused and called no tool. Reworked the system-prompt rule to key the "restricted"
  note off *what the tool actually returns* (not off "PII was asked for"), so the agent now calls
  the tool and answers from the visible columns. Framing matters: an early, heavier version made a
  *recruiter* (who may see PII) wrongly claim PII was restricted — fixed with "present whatever
  rows come back; only note a restriction for a column actually missing." Residual: `gpt-4o-mini`
  still refuses the *blunt* "give me every email and phone" extraction demand (safe, arguably
  correct) and is variable on neutral roster asks — every variant is PII-free and in-tenant.
- **"A few candidates" returned 1 row → now the correct set.** Root cause (found via tool-input
  logging added to the smoke script) was *not* the limit: the model invented a `stage:"applied"`
  filter and emitted `jobId:""`. Both `gpt-4o-mini` and `gpt-4o` compulsively fill optional
  params, and per-param "omit unless asked" descriptions didn't stop it (the model reads a
  description for the param's *value*, not for the *decision to include it*). Fix: **narrow the
  model-facing `listCandidates` surface to `source` + `limit`** (the query fn keeps `stage`/`jobId`
  for direct callers, still unit-tested) and coerce empty-string params to absent. "A few from
  referrals" now returns all 4 referral candidates.

Takeaway worth keeping: tool-arg fidelity is a real constraint with these models — design the
*surface* (which optional params to expose) for how the model behaves; don't rely on prose to
suppress over-filling.

### Fixes from manual real-model testing

A by-hand pass against `gpt-4o-mini` (prompts in `manual-test-prompts.md`, findings in
`manual-test-prompts-finds.md`) surfaced four **behavioural** defects — none a security
failure; tenant scope and the PII gate held by construction every time. All four traced to a
role-blind prompt plus two biasing tool descriptions, and were fixed at the prompt/description
layer only (the query layer, `scopeWhere`, and `candidateSelection` are untouched):

- **The system prompt was role-blind** (`SYSTEM_PROMPT` const → `buildSystemPrompt(role)`).
  The session role was never told to the model, so it guessed its own permissions — refusing a
  *recruiter*/*admin* roster ask, then narrating the wrong identity ("as an analyst I can't…"
  *while serving an admin*). The prompt now states the active role; this is narration/routing
  only — a prompt-injection that convinces the model it's an admin still can't make an
  analyst-session tool project PII, because the columns are never SELECTed. The pre-existing
  "present whatever rows come back; only note a restriction for a column actually missing" rule
  is kept verbatim, so a recruiter no longer wrongly claims a restriction either.
- **`applicationCountByStage` read as "needs a job."** A plain "how many are in the interview
  stage?" got a refusal asking for a job id. Reworded the description (and added a prompt rule)
  so single-stage counts route to the tool and read that one bucket; omit `jobId` unless named.
- **`jobsOverview` defaulted to open-only.** Its description led with "open positions," so
  "list all our jobs" returned open jobs (then three separate calls when corrected). Re-led with
  "list ALL jobs; omitting status returns every job in one call."
- **Per-job-by-name.** Asked to break stage counts down for the "Data Analyst" role, the model
  first invented a split of the workspace-wide numbers; an anti-fabrication rule then pushed it
  the other way — it passed the job *name* as a `jobId`, matching zero rows and rendering an
  empty chart. Neither is right. **Enabled it properly via tool-chaining** instead: the prompt
  now tells the model to call `jobsOverview` (which already returns the real `id`), match the
  title, and pass that id to `applicationCountByStage` (which already takes `jobId`) — so a
  named-role breakdown returns real per-stage counts. Fallback when no title matches: caveat the
  workspace-wide figure or ask — never a name-as-jobId, a fabricated split, or an empty chart.
  No code change to the tools (the id was already in the result); the lift was prompt + the
  `jobId` param description ("real id from jobsOverview, never a title"). Spec 00 +
  manual-test #28 updated to match the new capability.

Consistent with the smoke-test takeaway: these are *routing* fixes (under-calling / wrong
default), not over-filling, so prose is the right lever — but `gpt-4o-mini` stays variable, so
they're much-improved, not provably deterministic. The deterministic guarantees remain the
job of the unit tests + adversarial evals, which this pass left untouched.

## Post-spec polish

A short pass once all five specs were green, scoped for the submission rather than new
features (analytics depth was considered and deliberately left for "another day"):

- **Doc drift retired.** Several headers still read as a half-finished exercise — the
  `permissions.ts` "PII … NOT yet ENFORCED" TODO (enforcement has shipped), the
  `analytics.ts` "ships with ONE worked example … part of the exercise" framing, the
  `run.ts` "owning the loop is part of the exercise" note, and two stale `evals/run.ts`
  references (the file is `evals/copilot.eval.ts`). All rewritten to describe the code
  as it actually is.
- **Proof story widened** (`evals/copilot.eval.ts`, `analytics.test.ts`). The gate was
  only proven *negative* (analyst gets no PII). Added: a **positive control** (recruiter
  *does* get PII — proves the gate discriminates by role, isn't a blunt always-strip), a
  **prompt-injection** input (the by-construction enforcement holds even against a
  jailbreak ask, not just a polite one), a **combined-axis** case (analyst reaching
  cross-tenant must satisfy both `noPII` and `noForeignRows`), and a **schema-drift unit
  test** asserting every declared PII column is absent from an analyst's projection — so
  adding a PII column without gating it fails a test. The guard now guards itself. A
  **gated answer-quality LLM-judge** suite is wired but skipped unless a real model is
  configured, so `pnpm eval` stays deterministic and free by default.
- **Chart fix.** `BarChart` always drew 5 ticks via `(max·i)/4`, so small integer counts
  (the common case) printed fractional gridlines (0.75, 1.5, …). Ported `LineChart`'s
  integer-aware tick logic so axes read as clean integers.

## Trade-offs & cuts

- **No "tool library" abstraction.** Considered a `createScopedQueries(ctx)` factory /
  registry; rejected as needless cleverness — the `ctx`-first standalone pattern gives the
  same "can't forget scope" guarantee. The structure that earns its keep is the query layer,
  not a tool framework.
- **Scope cut-line** (if the box closes early): drop Spec 05 (over-time + line chart), trim
  UI polish, but keep the adversarial evals. The 2-hour checkpoint is Spec 00 + 01 + unit
  tests — the hard requirement proven against a real agent.
- **With another day:** a typed structured answer the agent emits (pairs with the evals);
  more analytics (time-to-hire, funnel conversion); an answer-quality LLM-judge eval; richer
  charts; and a deploy with the DB story written up.

## Working with the agent

- **Delegated:** parallel codebase exploration (mapping the agent / data / UI / eval layers),
  drafting the specs and this log, and — going forward — implementing each spec behind its
  acceptance gate for me to verify and question.
- **Where it was wrong and I caught it:**
  - It started *implementing* Spec 00 (wrote `.env`, edited the provider and vitest config)
    before the specs were even reviewed. I stopped it and had it revert — SDD means specs
    settle first.
  - Early on it entertained a "tool library" pattern I'd floated; pressed on *what problem it
    solves*, it conceded the repo already had a clean pattern and the abstraction was
    over-engineering. We moved the structure down to the query layer instead.
- **What I'd never let it decide alone:** the tenant/PII enforcement design (the hard
  requirement) — that's reviewed by hand and proven by tests I watch fail when the guard is
  deliberately broken; the scope cut-line; and anything that changes what data a role can see.

## Hours

Planning + grilling + specs: ~1h so far. Implementation budgeted ~3h against `specs/`
(running total updated as specs land).
