# Decisions

_Your write-up. Keep it brief — we're reading for trade-offs and reasoning, not
completeness. Delete these prompts as you fill them in._

## Overview

What you built and the state it's in. If something is half-done on purpose, say so —
that's a good answer, not a gap.

## Architecture & key decisions

- **Tool catalog** — Apart from the `applicationCountByStage` example the repo already
  ships, I plan to build four tools: `listCandidates` (the one that shows the PII
  gating), `jobsOverview` (which surfaces each job id so the model can turn a job title
  into an id for the other tools), `applicationsOverTime` and `applicationsBySource`.
  All of them take optional inputs with sensible defaults and closed enums, so the model
  can call any tool with an empty object, and each tool decides its own display instead
  of leaving that choice to the model. I preferred one tool per type of question over a
  single big tool, so the model's choice stays easy to read and each return type stays
  simple.
- **Query layer** — how it's structured and composed.
- **Tenant scoping** — Every read is tied to one workspace, and I wanted that to be
  impossible to forget rather than something I must remember each time. Two things from
  the repo already help: `ctx` carries the workspaceId and is the first argument of every
  query, so a query cannot even be written without the tenant in hand, and all filtering
  goes through one helper, `scopeWhere`, which always adds the workspace filter. There is
  no place where I write the filter by hand and might miss one. What I added is for joins.
  Before, `scopeWhere` scoped a single table, so the moment a query joins two tenant tables
  (say applications and candidates) only one side would be filtered and the other could
  leak. Now it takes every tenant table the query touches and scopes each one in the same
  call, so all the tenant filters sit together and a forgotten table is easy to spot in
  review. I kept this as one chokepoint plus review rather than a compiler guarantee. The
  type still helps a little, since a table passed in must have a `workspaceId` column, so I
  cannot pass the `workspaces` root table by accident. Making it fully safe at compile time
  would need a typed query builder around Drizzle, which felt like more complexity than it
  was worth. A small test covers the key case: a join scopes both tables, not just one.
- **Permissions** — how you enforce the PII rule by role.
- **Generative UI** — how tool results become streaming components.

## Model & agent

I wired the agent through OpenRouter. I chose this gateway because I already have
experience routing models through it, and it lets me A/B different models without
touching the provider code: `getModel()` already sends the OpenAI provider through a
`baseURL`, so it was only a matter of setting a few environment variables.

I started with the free `gpt-oss-120b` to keep everything at zero cost while building.
But it behaved poorly. Across a few runs it made wrong tool calls, and a couple of times
it answered with a hand-written ASCII table instead of returning the data for the UI to
render. Since changing the model is just one variable, I moved to
`google/gemini-2.5-flash-lite`, which called the tools correctly and respected the
display contract.

The loop itself comes from the repo: `streamText` with a six-step cap. I looked at
whether to change it and decided to keep it. A step here is one model generation (the
tool call that runs after it is free), so the loop normally stops on its own when the
model answers without asking for another tool, and the cap is only a safety net. The
longest path I expect is the two-tool chain, where the model asks `jobsOverview`, reads
back a `jobId` and then filters another tool with it; even if each of those calls needs
one retry, that is five steps, so six leaves a little room. I thought about making the
cap grow when the model keeps failing and decided against it, because a model that keeps
erroring is exactly the runaway the cap is there to stop.

For tool errors I keep it safe by default: if a query breaks, the user never sees
anything technical, only a clear message. Bad-args failures are recovered silently.
Concretely: the `analyticsTool` factory wraps every `execute` in a try/catch. On throw
it logs the real error server-side and returns a sanitized `{ error }` to the model,
which then narrates a calm explanation to the user.
The UI shows a muted note, not a red block. Bad-args validation failures (pre-execute)
are handled by the `z.preprocess` helper described below, so they rarely surface at all;
when they do the model retries silently and the user sees nothing. For anything outside
the tools (stream breaks, gateway errors, the loop hitting its cap without a final answer)
there are two `onError` nets: one that logs server-side, one that returns a single
friendly fallback string to the client. Nothing internal (stack traces, SQL, tenant
scope, PII) ever reaches the conversation or the UI.

Tool inputs also accept `null`, not only an absent value. When an input like `jobId` is
optional, the model sometimes sends `null` instead of leaving it out, and for a filter
both mean the same thing. Rather than widening the schema with `.nullish()`, I use
`z.preprocess(v => v ?? undefined, ...)` (see `src/agent/schema.ts`), so the model still
sees a clean and narrow schema (just an optional string) while the `null` is turned into
`undefined` before validation. This way a `null` doesn't cause a validation error and
waste a step, and I also avoid telling the model that `null` is a valid value in the
first place.

## Benchmarks

What your tenant-isolation and permission checks actually assert, and how you know
they catch the real thing.

## Trade-offs & cuts

What you deliberately left out and why. What you'd do with another day.

## Working with the agent

Using AI tools is encouraged. Briefly:

- What you delegated:
  - Commits.
  - Documentation writing.
  - Major code snippets.
- What the agent did wrong that I caught:
  - The first thing I caught was the agent letting model errors (for example, a
    bad input) reach the UI as a raw error, instead of showing the user a
    friendly message.
  - Duplicated or unused types, or stale small pieces of code.
- What you'd never let it decide on its own:
  - Architectural decisions.
  - Tools.

## Hours

Roughly how long you spent.
