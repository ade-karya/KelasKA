import { NextResponse } from 'next/server';
import { loadMcpConfig, saveMcpConfig } from '@/lib/mcp/config';
import { mcpClientManager } from '@/lib/mcp/client-manager';

export async function GET() {
  try {
    const config = loadMcpConfig();
    return NextResponse.json({ success: true, config });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { serverName, disabled } = body as { serverName: string, disabled: boolean };

    if (!serverName) {
      return NextResponse.json({ success: false, message: 'serverName is required' }, { status: 400 });
    }

    const config = loadMcpConfig();
    
    if (!config.mcpServers[serverName]) {
      return NextResponse.json({ success: false, message: 'Server not found in config' }, { status: 404 });
    }

    config.mcpServers[serverName].disabled = disabled;
    
    const saved = saveMcpConfig(config);
    if (!saved) {
      return NextResponse.json({ success: false, message: 'Failed to write to mcp.json' }, { status: 500 });
    }

    // Force reinitialization by reconnecting
    await mcpClientManager.disconnectAll();
    // We do NOT wait for it to reconnect here avoiding request blocks
    mcpClientManager.initializeAll().catch(e => console.error(e));

    return NextResponse.json({ success: true, config });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
