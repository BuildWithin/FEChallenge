import type { UIMessage } from "ai";

import { streamCopilot } from "@/agent/run";
import { tenantFromHeaders } from "@/server/context";

export const runtime = "nodejs";

// Multi-step tool-calling can run past the default serverless limit; give the
// streaming turn headroom (Vercel Hobby allows up to 60s).
export const maxDuration = 60;

export async function POST(req: Request) {
  const { workspaceId, role } = tenantFromHeaders(req);
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = await streamCopilot({ workspaceId, role, messages });
  return result.toUIMessageStreamResponse();
}
