# Spec 05 — Applications over time *(optional stretch)*

**Status:** Draft · **Depends on:** Specs 01–03 · **Estimate:** ~30m

## Goal
A time-series tool that justifies the `line` display kind end to end.

## Contract
```ts
// src/db/analytics.ts — group applications.appliedAt by ISO week, scoped via scopeWhere.
function applicationsOverTime(
  ctx: AnalyticsCtx,
  opts?: { jobId?: string },
): Promise<{ week: string; count: number }[]>
```
- `tools.ts`: `applicationsOverTime` tool → `display { kind: "line", x: "week", y: "count" }`.
- `page.tsx`: implement the `line` branch the Spec 03 dispatch left as a table fallback.

## In scope
One weekly time series + its tool + the line renderer.

## Out of scope
Arbitrary bucketing (day/month toggles), multi-series overlays.

## Acceptance
- [ ] "How have applications trended over time?" renders a line chart from scoped data.
- [ ] Still tenant-scoped (no foreign rows).

## Files
`src/db/analytics.ts`, `src/agent/tools.ts`, `src/app/page.tsx`

> Build only if time allows. This is the single reason the `line` kind exists; if cut, the UI's
> `line` branch stays a table fallback — no dead code.
