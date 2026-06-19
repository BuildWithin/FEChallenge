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
- **Tenant scoping** — how you made it impossible to forget as the layer grows.
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
erroring is exactly the runaway the cap is there to stop. For tool errors, the plan (not
built yet) is to send a short, safe message back when the arguments are wrong so the
model can retry, and to fail closed when a query itself breaks, without leaking the
scope, the SQL or any PII into the conversation.

Something I'm planning but haven't done yet is to let the tool inputs also accept `null`,
not only an absent value. When an input like `jobId` is optional, the model sometimes
sends `null` instead of leaving it out, and for a filter both mean the same thing. Rather
than widening the schema with `.nullish()`, I'll use `z.preprocess(v => v ?? undefined,
...)`, so the model still sees a clean and narrow schema (just an optional string) while
the `null` is turned into `undefined` before validation. This way a `null` doesn't cause
a validation error and waste a step, and I also avoid telling the model that `null` is a
valid value in the first place.

## Benchmarks

What your tenant-isolation and permission checks actually assert, and how you know
they catch the real thing.

## Trade-offs & cuts

What you deliberately left out and why. What you'd do with another day.

## Working with the agent

Using AI tools is encouraged. Briefly:

- What you delegated.
- Where the agent was wrong and you caught it.
- What you'd never let it decide on its own.

## Hours

Roughly how long you spent.
