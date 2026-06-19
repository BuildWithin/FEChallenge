# Model slice

Wiring a real model, the loop, and tool errors. Read this before editing
[src/agent/provider.ts](../../src/agent/provider.ts) or
[src/agent/run.ts](../../src/agent/run.ts).

## Real model via OpenRouter (no provider code change)

`getModel()` already supports an OpenAI-compatible provider routed through a base
URL. OpenRouter is OpenAI-compatible, so we wire it with env only:

```
AI_PROVIDER=openai
OPENAI_API_KEY=<OpenRouter API key>
AI_GATEWAY_BASE_URL=https://openrouter.ai/api/v1
OPENAI_MODEL=<an OpenRouter model id>
```

Why this works with no code change (verified against
[src/agent/provider.ts](../../src/agent/provider.ts) and
[src/env.ts](../../src/env.ts)):

- For `AI_PROVIDER=openai`, `getModel` builds `createOpenAI({ apiKey:
  process.env.OPENAI_API_KEY, baseURL })` where `baseURL = env.AI_GATEWAY_BASE_URL`,
  then `openai(env.OPENAI_MODEL)`.
- `env.OPENAI_MODEL` defaults to `gpt-4o-mini`; set it to the chosen OpenRouter
  model id. `AI_GATEWAY_BASE_URL` is optional and applied as the provider base URL.
- Put real keys in `.env.local` (not committed). The mock stays the default so the
  app boots and tests/evals run with zero setup.

The boot mock ([src/agent/mock-model.ts](../../src/agent/mock-model.ts)) calls one
best-matching tool with **empty args**, then summarizes — which is exactly why every
tool input must be optional with defaults (see tools slice). The real demo must show
the real agent answering, not the mock.

## Loop control

The loop is `streamText` with `stopWhen: stepCountIs(6)`
([src/agent/run.ts](../../src/agent/run.ts)). The thing to be clear about first is what
a "step" is: it's one model generation, and the tool execution that follows a tool call
is free — the reasoning and the call it triggers happen in the same step. So the loop
normally ends on its own, the moment the model returns text without asking for another
tool. `stopWhen` isn't the usual exit; it's a backstop for a model that won't stop.

I capped it at six. The longest realistic path is the two-tool chain — ask
`jobsOverview`, read back a `jobId`, then filter another tool with it — and if each of
those calls needs one retry to fix bad arguments, that runs call, error, retry, call,
error, retry, answer: five steps. Six leaves a little slack, and a clean run is three.

I considered letting the cap grow when the model hits errors and decided against it. A
model that keeps erroring is exactly the runaway I want the cap to catch, so raising the
ceiling as errors pile up would reward the failure I'm trying to stop. A fixed, small
number is also easier to reason about and to defend.

If the run does hit the cap without a final answer, it shouldn't go silent — better to
surface a short "I couldn't finish that, try rephrasing" than leave a half-finished turn
on screen. As for the answer itself, free prose plus the rendered artifact is enough:
the `{ rows, display }` artifact is the structured part, so I'm not forcing a second
typed answer on top of it.

## Tool-error handling

The mock never errors, but a real model against real queries will, and the two kinds of
error want opposite handling. When the model sends bad arguments, that's recoverable —
hand it back a short, safe message ("jobId must be a string or omitted") so its next
step is a corrected retry, which is the only error worth spending a step on. When a
query or something under it actually throws, retrying won't help, so the tool fails
closed: the UI shows a safe message through its existing `output-error` / `errorText`
path and the loop doesn't keep hammering it. Either way, nothing internal — a stack
trace, the SQL, the tenant scope, a PII value — ever goes back into the conversation.
The isolation and PII evals hold me to that.

## Tolerant tool inputs (null vs. omitted)

A small decision with a reason behind it: optional scalar inputs accept `null` as well
as an absent value, but I do it with `z.preprocess(v => v ?? undefined,
z.string().optional())` rather than `.nullish()`.

The model is a probabilistic producer of arguments, and for an optional filter a `null`
and a missing field mean the same thing: don't filter. `.optional()` on its own accepts
the missing field but rejects the `null`, and since the AI SDK validates arguments
against the schema, a model that sends `{"jobId": null}` hits a hard validation error and
burns a retry for nothing. So I want to tolerate the `null`.

The reason I prefer `preprocess` over `.nullish()` is the schema the model sees.
`.nullish()` would widen the advertised JSON Schema to say `null` is an allowed value,
which actually invites the model to send it. `preprocess` keeps the advertised schema
narrow (just an optional string) and quietly turns a `null` into `undefined` before
validation runs. The model is told the clean contract, analytics keeps its `string |
undefined` signatures, and a stray `null` no longer costs a step.

Worth being honest about the scope: `gemini-2.5-flash-lite` never actually sent a `null`
in my testing, so this is insurance against a future model swap, not something the demo
depends on. It still fits the reason I'm on OpenRouter, being able to A/B models without
touching code, because a catalog that breaks the moment you change models defeats that.
