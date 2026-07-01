# Roadmap — next steps

Reference for follow-up work after the take-home phases. Prompt guidance for
known gaps is in `src/agent/provider.ts` (honest limits until tools exist).

---

## Query layer & tools (closes “can’t answer” gaps)

Today the agent explains limits in prose when a question needs capabilities we
have not built. Implement these to make those answers real:

| Gap | User example | Proposed change |
| --- | --- | --- |
| **Date-range filters** | “Applications in the last month” | Extend `applicationsOverTime` (and related queries) with `since` / `until` or `sinceDays`; pass from tool schema |
| **Row-level applications** | “Show me the applications” | New `listApplications` query + tool — job title, stage, `appliedAt` (no PII beyond what role allows) |
| **Lookup by job title** | “Pipeline for the Data Analyst role” | Resolve job by title → `jobId` for `applicationCountByStage`, or add `jobTitle` filter on queries |
| **Conversion / time-to-hire** | “What’s our hire rate?” | New aggregate queries (applied → hired) or document as out of scope |
| **Candidate ↔ application join** | “Who applied to which job?” | Join tool with scoped columns, role-gated PII |

Remove or soften the matching **KNOWN LIMITATIONS** bullets in `buildSystemPrompt`
as each item ships.

---

## Product & UX

- Use ids to differentiate workspaces in the UI (today labels are slug strings)
- Cache / memory so chat history survives workspace or role switches (today `useChat` id resets the thread)
- Refine the frontend — establish a base design system to follow in code
- Revise terms and names to be more user-friendly (column labels, tool titles, permission copy)
- Improve performance in answers (streaming, fewer round-trips)

---

## Infra & quality

- LLM-as-judge evals for answer quality (beyond deterministic security evals)
- Richer chart library (optional; current SVG/CSS bars are intentional for scope)
- Gateway / provider config in CI for periodic real-model smoke tests
