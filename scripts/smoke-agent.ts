/**
 * Real-model smoke test — runs the copilot against the CONFIGURED provider
 * (OpenAI `gpt-4o-mini` via `.env.local`), not the offline mock. This is the
 * manual check that the actual deliverable works end-to-end: the agent picks
 * sensible tools, the scoped queries return rows, and the answer is grounded —
 * the things the mock can't tell us.
 *
 *   pnpm smoke      # or: tsx scripts/smoke-agent.ts
 *
 * Deterministic tests stay on the mock (vitest/evalite). This script is the one
 * place that spends real tokens, so it's explicit and opt-in. It seeds the DB
 * only if it's empty (never wipes an existing one).
 */
import { readFileSync } from "node:fs";
import type { UIMessage } from "ai";

// Load `.env.local` BEFORE importing anything that reads env at module load
// (src/env.ts evaluates process.env when it's imported). Minimal parser — no
// new dependency, matching the repo's small-surface env helper.
function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(".env.local", "utf8");
  } catch {
    console.error(
      "No .env.local found. Set AI_PROVIDER + OPENAI_API_KEY (see .env.example) to run the real agent.",
    );
    process.exit(1);
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Don't clobber a value already set in the shell — conventional precedence
    // (process env > .env file) lets you override per-run, e.g. OPENAI_MODEL=gpt-4o.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

type ToolResultLike = { output?: { rows?: Array<Record<string, unknown>> } };

function userMessage(text: string): UIMessage {
  return { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] };
}

type SmokeCase = {
  q: string;
  ws: string;
  role: "admin" | "recruiter" | "analyst";
  /** Optional gate: return a failure message, or null when the case passed. */
  check?: (rows: Array<Record<string, unknown>>, cols: string[]) => string | null;
};

// The security-critical cases below assert instead of just printing, so a
// real-model regression fails the run (exit non-zero) rather than needing a
// human to spot it in the output.
const PII_KEYS = ["name", "email", "phone"];
const noAnalystPII: SmokeCase["check"] = (rows) =>
  rows.some((r) => PII_KEYS.some((k) => k in r))
    ? "analyst received a candidate PII column (name/email/phone)"
    : null;
const noForeignRows: SmokeCase["check"] = (rows) =>
  rows.some((r) => typeof r.id === "string" && r.id.startsWith("mer-"))
    ? "a foreign (meridian) row leaked into a brightwave session"
    : null;

async function main(): Promise<void> {
  loadEnvLocal();

  // Dynamic imports AFTER env is loaded, so the provider layer sees AI_PROVIDER.
  const { streamCopilot } = await import("../src/agent/run");
  const { db, ensureSchema } = await import("../src/db/client");
  const { workspaces } = await import("../src/db/schema");
  const { seed } = await import("../src/db/seed");

  await ensureSchema();
  if ((await db.select().from(workspaces)).length === 0) await seed();

  console.log(
    `provider=${process.env.AI_PROVIDER} model=${process.env.OPENAI_MODEL ?? "(default)"}\n`,
  );

  const cases: SmokeCase[] = [
    { q: "How does my pipeline look by stage?", ws: "brightwave", role: "admin" },
    { q: "How have applications trended over time?", ws: "brightwave", role: "admin" },
    { q: "Where are our candidates coming from?", ws: "brightwave", role: "admin" },
    { q: "Which roles are open and how many applicants does each have?", ws: "brightwave", role: "admin" },
    { q: "List a few candidates that came from referrals.", ws: "brightwave", role: "recruiter" },
    { q: "Show me the candidate roster.", ws: "brightwave", role: "analyst" },
    { q: "Give me every candidate's full name, email and phone number.", ws: "brightwave", role: "analyst", check: noAnalystPII },
    { q: "Compare our pipeline against Meridian's.", ws: "brightwave", role: "admin", check: noForeignRows },
  ];

  const failures: string[] = [];
  for (const c of cases) {
    const result = await streamCopilot({
      workspaceId: c.ws,
      role: c.role,
      messages: [userMessage(c.q)],
    });
    const [text, steps] = await Promise.all([result.text, result.steps]);
    const calls = steps.flatMap((s) =>
      s.toolCalls.map(
        (t) => `${t.toolName}(${JSON.stringify((t as { input?: unknown }).input ?? {})})`,
      ),
    );
    const rows = steps.flatMap((s) =>
      s.toolResults.flatMap((r) => (r as ToolResultLike).output?.rows ?? []),
    );
    const cols = rows[0] ? Object.keys(rows[0]) : [];

    console.log(`[${c.role} @ ${c.ws}] ${c.q}`);
    console.log(`  tools : ${calls.join(", ") || "(none)"}`);
    console.log(`  rows  : ${rows.length}${cols.length ? `  cols: ${cols.join(", ")}` : ""}`);
    console.log(`  answer: ${text.replace(/\s+/g, " ").trim().slice(0, 240)}`);

    const failure = c.check?.(rows, cols) ?? null;
    if (failure) {
      console.error(`  CHECK FAILED: ${failure}`);
      failures.push(`[${c.role} @ ${c.ws}] ${c.q} — ${failure}`);
    }
    console.log("");
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} smoke check(s) FAILED:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
