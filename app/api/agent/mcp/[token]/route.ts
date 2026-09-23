/**
 * MCP tool bridge for CLI-served agent drivers.
 *
 * When the `opencode` CLI owns the agent loop it cannot receive tool
 * definitions (it never returns tool calls to its caller), so it reaches this
 * app's tools through MCP instead: `lib/ai/opencode-cli.ts` injects a stdio
 * bridge (`scripts/opencode-mcp-bridge.mjs`) into a private
 * `OPENCODE_CONFIG_DIR`, and the bridge talks to these two endpoints.
 *
 *   GET  /api/agent/mcp/<token>  -> { tools: [{ name, description, inputSchema }] }
 *   POST /api/agent/mcp/<token>  -> { content, isError, details } for { name, args }
 *
 * Authorization is the token alone (a 256-bit per-run secret held only by the
 * run's own bridge process), which is why the route is exempt from the
 * access-code cookie in `middleware.ts` — a local CLI process cannot hold one.
 * An unknown or expired token answers 404 and reveals nothing.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { apiError } from '@/lib/server/api-response';
import {
  callRunTool,
  getRunToolset,
  listRunTools,
  liveToolsetCount,
  type RunToolResult,
} from '@/lib/server/agent-runtime/mcp-registry';

export const runtime = 'nodejs';

interface Params {
  params: Promise<{ token: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { token } = await params;
  const entry = getRunToolset(token);
  if (!entry) {
    // An unknown token is the one failure mode that is invisible from the
    // outside: the CLI reports a bare "tool list failed: HTTP 404". Name the
    // token prefix and the live-entry count so an operator can tell an expired
    // run from a bridge that reached the wrong process.
    console.warn(
      `[agent-mcp] unknown bridge token ${token.slice(0, 8)}… (live toolsets: ${liveToolsetCount()})`,
    );
    return new Response('Not found', { status: 404 });
  }
  return NextResponse.json({ tools: listRunTools(entry) });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;
  const entry = getRunToolset(token);
  if (!entry) return new Response('Not found', { status: 404 });

  let body: { name?: unknown; args?: unknown } = {};
  try {
    body = ((await req.json()) ?? {}) as typeof body;
  } catch {
    return apiError('INVALID_REQUEST', 400, 'invalid JSON body');
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return apiError('MISSING_REQUIRED_FIELD', 400, 'name is required');

  const result: RunToolResult = await callRunTool(entry, name, body.args);
  return NextResponse.json(result);
}
