#!/usr/bin/env node
/**
 * MCP stdio bridge between the OpenCode CLI and this app's agent tools.
 *
 * The CLI loads this script as a local MCP server (see
 * `OpencodeMcpServer` in `lib/ai/opencode-cli.ts`). The script itself holds no
 * tools: it asks the app for the run's tool list and forwards every call back,
 * so the tools stay exactly the ones the runner assembled for that session
 * (owner-scoped stores, lease fencing, durable event emission included).
 *
 * Environment (set by the transport when it spawns this process):
 *   OPENMAIC_MCP_URL    base URL of the app, e.g. http://127.0.0.1:3000
 *   OPENMAIC_MCP_TOKEN  per-run bridge token
 *
 * It must never print to stdout except protocol frames: stdout is the MCP
 * channel. Diagnostics go to stderr, which the CLI collects.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const baseUrl = (process.env.OPENMAIC_MCP_URL ?? '').replace(/\/+$/, '');
const token = process.env.OPENMAIC_MCP_TOKEN ?? '';

if (!baseUrl || !token) {
  process.stderr.write(
    'openmaic-mcp-bridge: OPENMAIC_MCP_URL and OPENMAIC_MCP_TOKEN are required\n',
  );
  process.exit(1);
}

const endpoint = `${baseUrl}/api/agent/mcp/${encodeURIComponent(token)}`;
// Never log the full token: a prefix identifies the run in the app's
// `[agent-mcp] unknown bridge token …` warning without leaking the secret.
const tokenPrefix = token.slice(0, 8);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET the run's tool list, tolerating a briefly-unavailable app (restart,
 * dev HMR reload) before failing loud. A persistent 404 means the bridge
 * reached a server that does not hold this run: wrong OPENMAIC_MCP_BASE_URL /
 * PORT, a deployment without /api/agent/mcp/[token], or an app restart that
 * wiped the in-process registry mid-run.
 */
async function fetchToolList(attempts = 5, delayMs = 750) {
  let lastError = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(endpoint, { method: 'GET' });
      if (res.ok) {
        const body = await res.json();
        return body.tools ?? [];
      }
      lastError = `HTTP ${res.status}`;
      // A 404 from the right server still converges once the run registers;
      // anything else (or the last attempt) stops the wait.
      if (res.status !== 404 || attempt >= attempts) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt >= attempts) break;
    }
    await sleep(delayMs);
  }
  throw new Error(
    `tool list failed: ${lastError} (bridge reached ${baseUrl} with token ${tokenPrefix}…)`,
  );
}

const server = new Server({ name: 'openmaic', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await fetchToolList() }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params ?? {};
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, args: args ?? {} }),
  });
  if (!res.ok) {
    return {
      content: [{ type: 'text', text: `tool call failed: HTTP ${res.status}` }],
      isError: true,
    };
  }
  const body = await res.json();
  return {
    content: Array.isArray(body.content) ? body.content : [{ type: 'text', text: '' }],
    isError: body.isError === true,
  };
});

await server.connect(new StdioServerTransport());
