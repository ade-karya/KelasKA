import { tool as vercelTool, jsonSchema } from 'ai';
import { mcpClientManager } from './client-manager';
import { createLogger } from '@/lib/logger';

const log = createLogger('MCP:AiAdapter');

/**
 * Ensures all remote MCP servers are initialized and returns their tools
 * mapped to the Vercel AI SDK tool() format.
 */
export async function getMcpContextTools(): Promise<Record<string, any>> {
  try {
    await mcpClientManager.initializeAll();
  } catch (error) {
    log.error('Failed to initialize MCP servers for AI context', error);
    return {};
  }

  const allMcpTools = mcpClientManager.getAllTools();
  const vercelTools: Record<string, any> = {};

  for (const { serverName, tool } of allMcpTools) {
    // Prefix tool name to guarantee uniqueness across different servers
    // e.g. "canvadev_list_components"
    const safeServerName = serverName.replace(/[^a-zA-Z0-9]/g, '');
    const safeToolName = tool.name.replace(/[^a-zA-Z0-9_]/g, '_');
    const toolIdentifier = `${safeServerName}_${safeToolName}`;

    vercelTools[toolIdentifier] = vercelTool({
      description: `[From external MCP server '${serverName}'] ${tool.description || ''}`,
      parameters: jsonSchema(tool.inputSchema as any),
      execute: async (args: any) => {
        try {
          const result = await mcpClientManager.callTool(serverName, tool.name, args);
          // Standard MCP result format: { content: [{ type: 'text', text: '...' }] }
          return result;
        } catch (error: any) {
          log.error(`MCP Tool execution failed: ${toolIdentifier}`, error);
          return { error: error.message || 'Tool execution failed' };
        }
      }
    } as any);
  }

  return vercelTools;
}
