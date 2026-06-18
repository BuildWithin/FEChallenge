# Decisions

Brief write-up of trade-offs for the ATS Analytics Copilot take-home.

## Overview

Multi-tenant analytics copilot: scoped PGlite data, eight analytics tools with shared filters, generative charts/tables, Evalite safety benchmarks, and a polished chat UI. Runs offline on a mock model or live via Anthropic/OpenAI.

## Architecture & key decisions

- **Tool catalog** — Eight application-scoped tools plus `listJobs` for ID discovery. Inputs share one Zod filter shape (`jobId`, `source`, `dateFrom`, `dateTo`, `department`) so the model learns a single vocabulary.
- **Query layer** — `createScope()` + `scopeWhere()`; source/department filters use scoped `EXISTS` subqueries so joins cannot leak tenants.
- **Permissions** — PII columns selected only in analyst-safe branches; tools redact rows/display columns as defense in depth.
- **Generative UI** — Tool results carry `display` hints (bar/line/table) plus deterministic `insights[]` rendered as callouts and fed back via `prepareStep`.

## Model & agent

- **Provider:** Anthropic by default (`.env.local`), mock for CI/evals. Gateway-ready via `AI_GATEWAY_BASE_URL`.
- **Stop strategy:** `stopWhenAnswerReady` stops after a final text turn once tool data (or a handled tool error) exists; `stepCountIs(8)` remains a safety cap.
- **Insight layer:** `deriveInsights()` computes trend lines from rows (funnel drop-off, slowest stage, top source, etc.). Injected into `prepareStep` so the model summarizes actionable trends, not raw tables.
- **Tool errors:** Tools throw descriptive errors; UI shows failure state + retry hints; mock/real prompts require plain-language explanation without inventing data.
- **Rate limiting (stretch):** In-memory 30 req/min per workspace on `/api/chat`. Chosen over response caching or resumable streams — cheapest to reason about for a demo, easy to swap for Redis in production. **Not** using typed structured output yet: markdown + insight callouts keep the UI flexible without a second schema the model must satisfy.

## Benchmarks

Evalite suites assert: zero foreign `mer-`/`bw-` IDs in tool rows, analyst never sees PII fields, and answer-quality scorers (structural offline, LLM-judge when keys are set). Query-layer cases cover every analytics function directly.

## Trade-offs & cuts

- No stage history table — pipeline velocity uses `updatedAt − appliedAt` dwell time.
- Rate limit is process-local (resets on deploy); no distributed cache.
- DECISIONS intentionally brief; would add OpenTelemetry on tool latency next.

## Working with the agent

Used AI assistance for boilerplate and eval wiring; manually verified tenant scoping, PII branches, and benchmark assertions. Never auto-committed without `pnpm test && pnpm eval && pnpm build`.

## Hours

~3–4 hours across tool catalog, scoping, permissions, UI, evals, and agent hardening.
