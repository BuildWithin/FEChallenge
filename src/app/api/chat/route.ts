import type { UIMessage } from "ai";

import { streamCopilot } from "@/agent/run";
import { tenantFromHeaders } from "@/server/context";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { workspaceId, role } = tenantFromHeaders(req);
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = await streamCopilot({ workspaceId, role, messages });
  return result.toUIMessageStreamResponse({
    onError(error) {
      console.error("[chat route error]", error);
      return "Something went wrong on our side. Please try again.";
    },
  });
}
