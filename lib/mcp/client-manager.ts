import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadMcpConfig, McpServerConfig } from './config';
import { createLogger } from '@/lib/logger';
import { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';

const log = createLogger('MCP:ClientManager');

export interface McpClientInstance {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  tools: McpTool[];
}

// Global register to keep connections alive during dev hot-reloads
const globalForMcpClient = globalThis as unknown as {
  mcpClientManager?: McpClientManager;
};

export class McpClientManager {
  private instances: Map<string, McpClientInstance> = new Map();
  private initializationPromise: Promise<void> | null = null;
  
  constructor() {
    // Only bind process exit once
    if (typeof process !== 'undefined') {
      process.on('exit', () => {
        this.disconnectAll();
      });
    }
  }

  /**
   * Initializes all servers from mcp.json. This is idempotent.
   */
  public async initializeAll(): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      try {
        const config = loadMcpConfig();
        const serverNames = Object.keys(config.mcpServers);

        if (serverNames.length === 0) {
          log.info('No MCP servers configured in mcp.json');
          return;
        }

        log.info(`Initializing MCP servers: ${serverNames.join(', ')}`);

        // Clean up previously orphaned instances if any
        if (this.instances.size > 0) {
          await this.disconnectAll();
        }

        const promises = Object.entries(config.mcpServers).map(([name, serverConfig]) => {
          if (serverConfig.disabled) {
            log.info(`MCP server '${name}' is disabled in configuration. Skipping.`);
            return Promise.resolve();
          }
          return this.connectServer(name, serverConfig);
        });

        await Promise.allSettled(promises);
        this.initializationPromise = null; // Allow re-initialization if needed
        log.info(`Initialized ${this.instances.size} MCP servers running in background.`);
      } catch (error) {
        log.error('Failed to initialize MCP servers', error);
      }
    })();

    return this.initializationPromise;
  }

  private async connectServer(name: string, config: McpServerConfig): Promise<void> {
    try {
      const client = new Client({
        name: `kelaska-mcp-client-${name}`,
        version: '1.0.0',
      }, {
        capabilities: {},
      });

      // Strip undefined from process.env
      const safeEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) safeEnv[k] = v;
      }
      for (const [k, v] of Object.entries(config.env || {})) {
        if (v !== undefined) safeEnv[k] = v;
      }

      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: safeEnv,
      });

      await client.connect(transport);
      log.info(`Connected to MCP server: ${name}`);

      // Fetch supported tools
      const toolsResult = await client.listTools();
      const tools = toolsResult.tools || [];
      
      this.instances.set(name, {
        name,
        client,
        transport,
        tools,
      });

    } catch (error) {
      log.error(`Failed to connect to MCP server: ${name}`, error);
      throw error; // Re-throw to be caught by Promise.allSettled
    }
  }

  /**
   * Retrieves all loaded tools from all connected MCP servers.
   */
  public getAllTools(): { serverName: string, tool: McpTool }[] {
    const allTools: { serverName: string, tool: McpTool }[] = [];
    
    for (const [serverName, instance] of this.instances.entries()) {
      for (const tool of instance.tools) {
        allTools.push({ serverName, tool });
      }
    }
    
    return allTools;
  }

  /**
   * Dispatches a tool call to the respective external MCP server.
   */
  public async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const instance = this.instances.get(serverName);
    if (!instance) {
      throw new Error(`MCP Server '${serverName}' is not connected or not found.`);
    }

    log.info(`Executing tool ${toolName} on server ${serverName}`);
    const result = await instance.client.callTool({
      name: toolName,
      arguments: args
    });

    return result;
  }

  public async disconnectAll(): Promise<void> {
    for (const [name, instance] of this.instances.entries()) {
      try {
        await instance.transport.close();
        log.info(`Disconnected MCP server: ${name}`);
      } catch (e) {
        log.error(`Error disconnecting ${name}`, e);
      }
    }
    this.instances.clear();
  }
}

export const mcpClientManager = globalForMcpClient.mcpClientManager || new McpClientManager();

if (process.env.NODE_ENV !== 'production') {
  globalForMcpClient.mcpClientManager = mcpClientManager;
}
