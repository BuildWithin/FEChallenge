import type { UIMessage } from "ai";

import { streamCopilot } from "@/agent/run";
import { checkRateLimit } from "@/server/rate-limit";
import { tenantFromHeaders } from "@/server/context";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { workspaceId, role } = tenantFromHeaders(req);
  const limit = checkRateLimit(`${workspaceId}:${role}`);

  if (!limit.allowed) {
    return Response.json(
      {
        error: `Rate limit exceeded for this workspace. Retry in ${limit.retryAfterSec}s.`,
      },
      {
        status: 429,
        headers: limit.retryAfterSec
          ? { "Retry-After": String(limit.retryAfterSec) }
          : undefined,
      },
    );
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = await streamCopilot({ workspaceId, role, messages });
  return result.toUIMessageStreamResponse();
}
