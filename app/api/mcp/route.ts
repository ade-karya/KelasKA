import { type NextRequest } from 'next/server';
import { initializeMcpServer, mcpTransport } from '@/lib/server/mcp-server';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Max allowed by Vercel for lengthy generation

// Helper to check MCP_SECRET_KEY
function checkAuth(req: NextRequest) {
  const secretKey = process.env.MCP_SECRET_KEY;
  if (!secretKey) {
    // If no secret key is configured, warn but allow for local dev
    if (process.env.NODE_ENV !== 'production') {
      return true;
    }
    console.warn('MCP_SECRET_KEY is not configured. Rejecting request.');
    return false;
  }

  const authHeader = req.headers.get('Authorization') || req.headers.get('x-mcp-key');
  if (!authHeader) return false;

  const token = authHeader.replace(/^Bearer\s/i, '').trim();
  return token === secretKey;
}

async function handleMcpRequest(req: NextRequest) {
  // 1. Authenticate Request
  if (!checkAuth(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Initialize Server if not already done
  const baseUrl = buildRequestOrigin(req);
  await initializeMcpServer(baseUrl);

  // 3. Let WebStandardStreamableHTTPServerTransport handle the Request natively
  // It handles both GET (for SSE stream setup) and POST (for incoming JSON-RPC messages)
  try {
    const response = await mcpTransport.handleRequest(req);
    return response;
  } catch (err: unknown) {
    console.error('MCP Transport Error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function GET(req: NextRequest) {
  return handleMcpRequest(req);
}

export async function POST(req: NextRequest) {
  return handleMcpRequest(req);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-mcp-key',
    },
  });
}
