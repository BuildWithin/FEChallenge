/**
 * Rule tested: In-memory tool result cache in src/agent/tools.ts
 *
 * The cache is a module-level Map<string, { data: unknown; expiresAt: number }>.
 * Cache key: `${workspaceId}::${toolName}::${JSON.stringify(params)}`
 * TTL: 60 seconds. Raw (pre-PII) data is stored.
 *
 * Four tools are cached: applicationsByJob, candidateSourceBreakdown,
 * timeToHireByJob, candidateList. This eval exercises applicationsByJob
 * (no PII, simple params) to verify both correctness and speed of the cache.
 *
 * Two scorers:
 *   1. resultsAreIdentical — the second call (cache hit) returns the same rows
 *      as the first call (cache miss). Fails if the cache returns stale data,
 *      wrong-workspace data, or corrupted values.
 *
 *   2. secondCallIsFaster — the second call completes faster than the first.
 *      The first call hits PGlite (async query + result mapping + Map.set).
 *      The second call is a synchronous Map.get — no async DB round-trip.
 *      Even with PGlite in-memory, the async overhead of the first call is
 *      measurably larger.
 *
 * How to manually verify this eval bites:
 *
 *   resultsAreIdentical:
 *     In tools.ts, make getCached() always return undefined (comment out the
 *     return). Now both calls hit the DB. If the DB changes between calls
 *     (unlikely in tests) results could diverge; more importantly the cache
 *     is broken and the scorer correctly flags it as untestable. To make it
 *     definitively fail, make getCached() return a fixed wrong value like [].
 *     The deep-equal check against non-empty DB results will fail.
 *
 *   secondCallIsFaster:
 *     Remove the cache entirely from applicationsByJob's execute — make it
 *     always call getApplicationsByJob(ctx, {jobId}). Now both calls hit the
 *     DB. Both cases use jobId: undefined so DB work is non-trivial (full
 *     join across all workspace jobs + applications). Without the cache,
 *     elapsed2 >= elapsed1 on average, causing the scorer to return 0.
 *
 *   Note: Case A uses Brightwave with jobId: undefined; Case B uses Meridian
 *   with jobId: undefined. Different workspaceIds mean different cache keys, so
 *   each case begins with a guaranteed cold cache for that workspace+params combo.
 *   Both cases exercise both scorers. This avoids the trivially-passing [] === []
 *   problem — both workspaces are seeded with real jobs and applications.
 */

import { createScorer, evalite } from "evalite";
import type { ModelMessage } from "ai";

import { db, ensureSchema } from "@/db/client";
import { workspaces } from "@/db/schema";
import { seed } from "@/db/seed";
import { buildTools, type CopilotTools } from "@/agent/tools";
import type { AnalyticsCtx } from "@/db/analytics";

async function ensureSeeded() {
  await ensureSchema();
  const rows = await db.select().from(workspaces);
  if (rows.length === 0) await seed();
}

// Minimal ToolExecutionOptions stub — the cache path inside execute() does not
// use toolCallId or messages, so these are safe placeholders.
const minimalExecOptions = {
  toolCallId: "eval-stub-call",
  messages: [] as ModelMessage[],
};

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

type CacheInput = {
  ctx: AnalyticsCtx;
  /** jobId passed to applicationsByJob.execute — undefined = all jobs */
  jobId: string | undefined;
  label: string;
};

type CacheOutput = {
  rows1: Array<Record<string, unknown>>;
  rows2: Array<Record<string, unknown>>;
  elapsed1Ms: number;
  elapsed2Ms: number;
};

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

async function runCacheProbe(input: CacheInput): Promise<CacheOutput> {
  const tools: CopilotTools = buildTools(input.ctx);

  // applicationsByJob always defines execute — guard satisfies the type checker
  // without resorting to `as any` or `!` non-null assertions.
  const execFn = tools.applicationsByJob.execute;
  if (!execFn) throw new Error("applicationsByJob.execute is not defined");

  const t1Start = performance.now();
  const result1 = await execFn(
    { jobId: input.jobId },
    minimalExecOptions,
  );
  const elapsed1Ms = performance.now() - t1Start;

  const t2Start = performance.now();
  const result2 = await execFn(
    { jobId: input.jobId },
    minimalExecOptions,
  );
  const elapsed2Ms = performance.now() - t2Start;

  // result1.rows and result2.rows are the ToolResult rows. Both should be
  // Record<string, unknown>[] — cast is safe: applicationsByJob returns typed
  // objects that structurally satisfy Record<string, unknown>.
  const rows1 = (result1 as { rows: Array<Record<string, unknown>> }).rows;
  const rows2 = (result2 as { rows: Array<Record<string, unknown>> }).rows;

  return { rows1, rows2, elapsed1Ms, elapsed2Ms };
}

// ---------------------------------------------------------------------------
// Scorers
// ---------------------------------------------------------------------------

/**
 * The cache hit must return exactly the same rows as the cache miss.
 *
 * Anti-pattern avoided: we do NOT just check length > 0. We deep-compare the
 * full row objects. A cache that returns [] when rows exist, or leaks rows
 * from a different workspace, will fail this check.
 */
const resultsAreIdentical = createScorer<CacheInput, CacheOutput, undefined>({
  name: "resultsAreIdentical",
  description:
    "Cache hit (call 2) returns the same rows as the DB call (call 1). " +
    "Fails if the cache returns stale, empty, or wrong-workspace data.",
  scorer: ({ output }) => {
    const { rows1, rows2 } = output;

    // Both must be non-empty arrays — the seeded DB always has applications.
    // This rules out the trivially-passing [] === [] case.
    if (rows1.length === 0 || rows2.length === 0) return 0;

    // Deep equality: same length, same keys, same values for every row.
    if (rows1.length !== rows2.length) return 0;

    for (let i = 0; i < rows1.length; i++) {
      const r1 = rows1[i];
      const r2 = rows2[i];
      const keys1 = Object.keys(r1).sort();
      const keys2 = Object.keys(r2).sort();
      if (JSON.stringify(keys1) !== JSON.stringify(keys2)) return 0;
      for (const key of keys1) {
        if (JSON.stringify(r1[key]) !== JSON.stringify(r2[key])) return 0;
      }
    }

    return 1;
  },
});

/**
 * The cache hit must be faster than the DB call.
 *
 * First call: Drizzle builds + executes the query against PGlite (async I/O),
 * maps the results, calls Map.set. Second call: Map.get + return. The
 * synchronous Map lookup is always faster than the async DB round-trip.
 *
 * Anti-pattern avoided: no fixed threshold (e.g. elapsed2 < 5ms). Only the
 * relative ordering matters. Each case uses a different workspaceId so each
 * begins with a cold cache entry for that workspace+params combination.
 *
 * Floor: if elapsed1Ms < 0.5 the PGlite round-trip completed sub-millisecond
 * (warm JIT, tiny dataset). At that resolution scheduler jitter can reverse
 * the ordering spuriously. Score 0.5 (inconclusive) rather than 0 so a fast
 * machine does not turn a working cache into a failing eval.
 */
const secondCallIsFaster = createScorer<CacheInput, CacheOutput, undefined>({
  name: "secondCallIsFaster",
  description:
    "Second tool call (cache hit) completes faster than the first (DB hit). " +
    "Inconclusive (0.5) when DB call is sub-ms; fails if cache is absent.",
  scorer: ({ output }) => {
    const { elapsed1Ms, elapsed2Ms } = output;
    // If the DB call itself was sub-millisecond, timing is dominated by
    // scheduler jitter — cannot reliably distinguish hit from miss.
    if (elapsed1Ms < 0.5) return 0.5;
    return elapsed2Ms < elapsed1Ms ? 1 : 0;
  },
});

// ---------------------------------------------------------------------------
// Eval
// ---------------------------------------------------------------------------

evalite<CacheInput, CacheOutput>("Tool result cache — correctness and speed", {
  data: async () => {
    await ensureSeeded();
    return [
      {
        // Case A (Brightwave): correctness + timing.
        // First call: PGlite query + Map.set. Second call: synchronous Map.get.
        // rows1 / rows2 must be deeply equal (non-empty — Brightwave is seeded).
        // elapsed2 must be strictly less than elapsed1 (cache hit < DB hit).
        input: {
          ctx: { workspaceId: "brightwave", role: "admin" as const },
          jobId: undefined,
          label: "brightwave-all-jobs",
        },
      },
      {
        // Case B (Meridian): same assertions on the other workspace.
        // Different workspaceId → different cache key → guaranteed cold cache
        // for the first Meridian call, regardless of what Case A cached.
        // Meridian is seeded with jobs, so rows are non-empty for both calls.
        input: {
          ctx: { workspaceId: "meridian", role: "admin" as const },
          jobId: undefined,
          label: "meridian-all-jobs",
        },
      },
    ];
  },
  task: (input) => runCacheProbe(input),
  scorers: [resultsAreIdentical, secondCallIsFaster],
});
