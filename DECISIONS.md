# Decisions

_Your write-up. Keep it brief — we're reading for trade-offs and reasoning, not
completeness. Delete these prompts as you fill them in._

## Overview

A multi-tenant ATS analytics copilot. You ask about one workspace's recruiting data in plain
language; the agent picks from a small set of read-only tools and the UI renders each result
as a table, bar, or line while the answer streams. Two rules are enforced by construction in
the query layer: every read is scoped to the caller's workspace, and candidate PII is gated by
role so an analyst never receives it. It runs offline on the repo's deterministic mock model
for evals, and against `gemini-2.5-flash` through OpenRouter for real use. State: complete and
green (typecheck, build, tests, evals). The five tools, generative UI, error handling, and a
token-based design system are done, plus key-gated real-model evals for tool routing and
judged answer quality.
One thing is deliberately a written plan rather than code, and I say why below: the
response-caching stretch.

## Architecture & key decisions

- **Tool catalog** — Apart from the `applicationCountByStage` example the repo already
  ships, I built four tools: `listCandidates` (the one that shows the PII gating, a
  table), `jobsOverview` (which surfaces each job id so the model can turn a job title
  into an id for the other tools, a table), `applicationsOverTime` (a line) and
  `applicationsBySource` (a bar). All of them take optional inputs with sensible defaults
  and closed enums, so the model can call any tool with an empty object, and each tool
  decides its own display instead of leaving that choice to the model. I preferred one
  tool per type of question over a single big tool, so the model's choice stays easy to
  read and each return type stays simple.
- **Query layer** — All the database access for the copilot lives in one module,
  `analytics.ts`, and nothing else touches the database. The repo set this shape and I
  kept it: every function takes `ctx` first and returns plain rows, display-agnostic, and the
  tool that wraps them decides how to render. Keeping every read in this one layer, behind shared helpers,
  is also what lets me enforce the two hard rules in a single place instead of scattering
  them across tools: tenant scoping and PII gating, each described in its own note below.
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
- **Permissions** — An analyst never sees a candidate's name, email
  or phone, while a recruiter or admin can. I enforce it in two layers. At runtime the
  candidate query selects the PII columns only when the role is allowed, so for an analyst
  those columns are never even fetched. On top of that I get a type
  guarantee: the query returns one of two row shapes, a public one without PII and a full
  one with it, so to read a name the code has to first prove it has the full shape, and an
  analyst's rows never have it. So reading PII off an analyst row is a compile error. I was
  honest with myself about the limit. The role is a runtime value (it comes from a header),
  so the types cannot automatically know that an analyst means no PII at the call site,
  and once the rows cross into the generic tool result type that information is gone anyway.
  I did not want to chase that with heavy generics or overloads that would force a role check
  at every call site, so the type protection lives where it counts, in the query projection,
  and from the tool boundary onward I rely on the runtime guarantee plus the eval. The list
  of PII columns lives in one place (`PII_COLUMNS`), and a small test makes sure the projection
  cannot drift from it.
- **Generative UI** — Each tool returns `{ rows, display }`, and the tool decides the
  display, not the model and not the UI. The page only reads `display.kind` and renders:
  a table, a bar chart or a line chart. I built the two charts as plain SVG instead
  of pulling in a charting library, because the shapes are simple and I would rather keep
  the dependency surface small and the rendering easy to read. The result is rendered while
  the agent streams. I handle the states that would otherwise look broken: an empty result
  shows a calm "no
  data" line rather than an empty chart, a tool error shows a muted note rather than a red
  block, and a call that the model retried and recovered leaves no card behind. One thing I
  was careful about is that the UI never reintroduces PII: it renders only the columns the
  tool hands it, so when an analyst's rows come back without name, email or phone, there is
  no column there to show. The PII decision stays upstream in the query, the UI just draws
  what it is given.
- **Frontend layer** — The first cut put everything in `page.tsx`: the page shell, the chat,
  the tool-call lifecycle and all three renderers, plus the chart layout constants, about 520
  lines in one file. I split that into a small frontend layer. `page.tsx` now keeps only the
  hooks and composes the pieces (about 70 lines), and the presentational parts live in
  `src/components` (chat, charts, tenant, pipeline) with shared constants in `src/lib`. I
  chose a flat `components` plus `lib` shape over a heavier `features/` slice, because there
  is one feature here and a slice would be more nesting than the code earns, and the repo
  already groups by flat top-level folders (`agent`, `db`, `server`), so this matches what
  was already there. I also pulled the magic values into named constants: the SVG geometry,
  the chart colors, the font sizes and the table row cap. It was a pure structural pass with
  no change to what renders, which made it easy to verify.
- **Design tokens and the redesign** — Before touching the look I built a color system: two raw
  scales as CSS variables, semantic tokens layered on top, and Tailwind mapping utility names to
  them, so a component names a role like `surface` or `accent` instead of a raw shade, and the
  SVG charts read the same tokens. The reason is leverage: the next visual change is a few
  variables, not a sweep across files. For the layout I deliberately followed the conventions of
  the analytics and chat tools people already use, since a familiar shape lets a user recognize
  the interface and know how to use it without learning it.

## Model & agent

I wired the agent through OpenRouter. I chose this gateway because I already have
experience routing models through it, and it lets me A/B different models without
touching the provider code: `getModel()` already sends the OpenAI provider through a
`baseURL`, so it was only a matter of setting a few environment variables.

I started with the free `gpt-oss-120b` to keep everything at zero cost while building.
But it behaved poorly. Across a few runs it made wrong tool calls, and a couple of times
it answered with a hand-written ASCII table instead of returning the data for the UI to
render. Since changing the model is just one variable, I moved to
`google/gemini-2.5-flash`, which called the tools correctly and respected the
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

I have two layers of checks. At the query layer there are unit tests: one proves a join
scopes every table it touches (both workspace filters show up in the generated SQL), and
the PII ones prove an analyst's rows come back without name, email or phone while a
recruiter's include them, plus a small test that ties the PII columns to a single source
so the projection cannot drift from it.

On top of those, two agent-level evals run the whole copilot loop, offline on the mock
model. The first asks for candidates as an analyst and fails if any returned row carries
PII. The second asks the same question as each workspace and fails if a returned
candidate id does not belong to the workspace that asked.

For the tenant eval the trusted list of ids comes from a direct query against the table, not
from the same function under test, so a broken scope cannot hide by comparing a buggy
query against itself. I also checked both evals by breaking the code on purpose: dropping
the PII branch turns the PII eval red, and removing the scope from the candidate query
turns the isolation eval red. After reverting, both go green again. One thing I learned
from the data is that the two workspaces share the same candidate names, so the isolation
eval checks ids rather than names, since the id is the only field that is actually unique
per workspace.

Two more evals need the real model, so they are gated on `AI_PROVIDER` and stay out of the
offline run, deliberately separate from the two safety evals so their noise can never turn a
safety gate red. The first checks tool routing: it asks each clear question and fails if the
agent doesn't call an acceptable tool. Some questions have more than one right route (for
example "pipeline by stage" is fine as either the aggregate bar or the per-job pivot), so it
scores against a set of acceptable tools, not a single one. The second judges answer quality:
a model grades whether the prose answer is accurate and grounded in the rows the tool returned.
The judge runs at temperature 0 so its verdict is stable and only the answer varies; it is
honestly a sanity check, not an oracle, since it is the same model family that answered. It
catches the real cases (an empty or content-free answer fails), which is the point.

## Trade-offs & cuts

- **Empty time buckets aren't filled** in `applicationsOverTime`. The line connects the buckets
  that have data; no `generate_series`. A simplicity cut, fine for this dataset.
- **PII safety is typed at the query projection, not the call site** (see Permissions). The role
  is a runtime header value, so a full compile-time guarantee would need a typed query builder or
  heavy generics. I chose the chokepoint plus the eval instead.
- **Hand-rolled SVG, no chart library.** Right for three simple shapes and a small dependency
  surface; a real product would want a library for axes, tooltips, and responsiveness.
- **The answer-quality judge is the same model family, and single-turn.** It's a grounding
  sanity check, not an independent oracle, and it doesn't cover the two-tool chain. With another
  day I'd judge with a different model and add multi-step cases, still key-gated and apart from
  the safety evals.
- **Caching is a plan, not built** (see the stretch below).

## Stretch — response caching

I picked response caching. The copilot is read-only and each query is deterministic given
`(workspaceId, role, tool, params)`, so results cache cleanly with no invalidation problem; a
short TTL is enough. The point that makes it interesting here: the cache key must include
`workspaceId` and `role`. Workspace is obvious. Role is the subtle one, because `listCandidates`
projects different columns by role, so a key missing the role could hand an analyst a recruiter's
cached rows with PII in them. The cache key is the same isolation boundary the query layer already
enforces; caching just extends it to a new surface. I'd build it as a thin wrapper at the
analytics layer keyed on those fields with a TTL, in-memory for one instance or Redis if it scales
out. I wrote it as a plan rather than code to avoid adding a brittle layer this late, which the
README explicitly allows.

## Working with the agent

Using AI tools is encouraged. Briefly:

- What you delegated:
  - Commits.
  - Documentation writing.
  - Major code snippets.
  - SVG generative UI
- What the agent did wrong that I caught:
  - The first thing I caught was the agent letting model errors (for example, a
    bad input) reach the UI as a raw error, instead of showing the user a
    friendly message.
  - Duplicated or unused types, or stale small pieces of code.
  - A query that passed the evals but crashed when it actually ran. In the
    applications-over-time query the agent reused the same SQL bucket expression
    in the select, the group by and the order by. Each use rebinds its parameter,
    so Postgres did not see the group by as matching the select and threw an error.
    The evals stayed green because they only check that a tool returned rows, not
    that this query runs, so I caught it by running the query against the real data.
- What you'd never let it decide on its own:
  - Architectural decisions.
  - Tools.

## Hours

Roughly 5 focused hours, spread over three days.
