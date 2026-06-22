# Decisions

_Your write-up. Keep it brief — we're reading for trade-offs and reasoning, not
completeness. Delete these prompts as you fill them in._

## Phase 0 — Orientation & agent setup

### What was done before any code

- Studied the challenge with Claude.ai before touching the repo: read the README
  in depth, asked clarifying questions on scope, stack gaps (tRPC unfamiliar,
  AI SDK unfamiliar), and the "4 hours" signal (scope boundary, not a timer)
- Clarified stretch goal strategy: evaluate all four options + deploy, write
  trade-off analysis in DECISIONS.md, implement the winner
- Designed the 5-subagent roster on paper before writing any code
- Created TASKLIST.md, CLAUDE.md (extends starter), and .claude/agents/*.md
  from the planning session — committed before Phase 1

### Key decisions

- **5 subagents with tight scopes, not 1 general agent:** each has different
  non-negotiables (query-architect: never skip `scopeWhere`; tool-builder: never
  put `workspaceId` in Zod schema; eval-author: never write trivially-passing
  assertions). Splitting keeps rules sharp — a general agent would let them blur.
- **code-reviewer is deliberately read-only and separate:** independent review
  after each writing phase catches what the writing agent missed.
- **Anti-patterns captured upfront in CLAUDE.md:** listed specific failure modes
  before they happened — `workspaceId` in tool schema, PII filter in React
  component, `result.length > 0` eval assertion. Agent reads these at context load.
- **Progressive DECISIONS.md updates:** one bullet block per phase while reasoning
  is fresh. Prose expanded in Phase 10.
- **Provider: Anthropic** — aligns with the evaluators' own stack (they use Claude
  Code internally). Pending key acquisition.
- **Stretch: response caching** — reinforces the isolation story (cache key must
  include `workspaceId`, same way `scopeWhere` makes isolation structural).
  Visually demoable. Reduces LLM + DB cost on repeated questions.
- **Deploy: Vercel + Neon** — PGlite is file-backed, doesn't survive serverless
  cold starts. Neon is serverless Postgres, same Drizzle schema, free tier.

---

## Overview

What you built and the state it's in. If something is half-done on purpose, say so —
that's a good answer, not a gap.

## Architecture & key decisions

- **Tool catalog** — which tools you added, their granularity, and how you shaped
  their inputs for a model to drive.
- **Query layer** — how it's structured and composed.
- **Tenant scoping** — how you made it impossible to forget as the layer grows.
- **Permissions** — how you enforce the PII rule by role.
- **Generative UI** — how tool results become streaming components.

## Model & agent

Which provider or gateway you wired (Vercel AI Gateway / Cloudflare AI Gateway /
direct keys / Bedrock), and **why**. Anything notable about the loop — multi-step
control, tool-error handling, stop strategy, structured output.

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
