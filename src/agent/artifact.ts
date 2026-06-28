/**
 * The "generative UI" contract. Every agent tool returns rows plus a `display`
 * hint telling the UI how to render them (a table or a chart). The chat page
 * renders a component per tool result as the agent streams — see
 * src/app/page.tsx.
 */

/**
 * A single cell in a tool result. Our query rows are only ever text, counts,
 * timestamps, or computed numerics — never nested objects — so this is the
 * accurate value domain (no `unknown`).
 */
export type CellValue = string | number | boolean | Date | null;

/** One row of a tool result: column name -> scalar value. */
export type Row = Record<string, CellValue>;

export type Display =
  | { kind: "table"; columns: string[] }
  | { kind: "bar"; x: string; y: string; title: string }
  | { kind: "line"; x: string; y: string; title: string };

export type ToolResult = { rows: Row[]; display: Display };

/**
 * The lifecycle of a tool invocation as the AI SDK streams it into a message
 * part (`tool-<name>`). The chat UI renders off this.
 */
export type ToolUIState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

/**
 * A tool-call message part, narrowed to the fields the UI reads. The agent
 * fills tool inputs with scalars (ids, enums, limits), so `input` is a flat
 * record — no `unknown`.
 */
export type ToolUIPart = {
  type: string;
  state?: ToolUIState;
  input?: Record<string, CellValue>;
  output?: ToolResult;
  errorText?: string;
};
