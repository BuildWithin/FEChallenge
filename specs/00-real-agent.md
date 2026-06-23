# Spec 00 — Real OpenAI agent

**Status:** Draft · **Depends on:** — · **Estimate:** ~30m

## Goal
The copilot runs against a real OpenAI model with a system prompt that drives tools well and
declines gracefully, replacing the boot-only mock. The mock stays the default for tests.

## Contract
- **Env** (`.env.local`, gitignored — loaded by `next dev`, not by vitest/evalite):
  ```
  AI_PROVIDER=openai
  OPENAI_MODEL=gpt-4o-mini
  OPENAI_API_KEY=…
  ```
- **Test determinism** (`vitest.config.ts`): pin `test.env = { AI_PROVIDER: "mock" }` so unit
  tests never hit a real API even if the shell exports `AI_PROVIDER=openai`.
- **`buildSystemPrompt(role)`** (`src/agent/provider.ts`) — the system prompt is built per
  turn from the session `role` (run.ts passes it), so the model knows whom it serves instead
  of guessing. Narration/routing only; the hard PII gate stays by-construction in
  `candidateSelection`. It carries these behaviors (keep the existing
  scope/PII/prompt-injection rules):
  - States the active role: admin/recruiter may see PII (list it without hedging); an analyst
    sees PII columns absent and answers from the visible columns.
  - No tool fits → say so plainly; never fabricate numbers/names/sources/trends.
  - A tool fails → say it couldn't be retrieved; offer what *can* be answered.
  - Role hides data (analyst + PII) → answer with what's visible, note the detail is
    restricted for this role, never invent the hidden values.
  - Per-job scoping by name → chain jobsOverview (match title → real id) into the stage-count
    tool's `jobId`; never pass a title as a jobId. If no title matches, caveat the
    workspace-wide figure or ask which job — never fabricate a breakdown or emit an empty
    result from a guessed id.
- **Loop** (`src/agent/run.ts`): add `onError` to `streamText` so a tool/stream failure is
  surfaced (logged) instead of crashing the turn. Keep `stopWhen: stepCountIs(6)`.

## In scope
The four bullets above.

## Out of scope
New tools, query layer, UI, evals. (Per-tool structured error results land in Spec 02.)

## Acceptance
- [ ] `pnpm test` still passes on the mock (no network).
- [ ] With a real key, `pnpm dev` → "how does my pipeline look by stage?" → gpt-4o-mini calls
      the reference tool and streams a grounded answer.
- [ ] Asking something with no matching tool yields an honest "I can't answer that," not a
      fabricated number.

## Files
`.env.local`, `vitest.config.ts`, `src/agent/provider.ts`, `src/agent/run.ts`
