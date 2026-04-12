import fs from 'fs';
import path from 'path';
import { createLogger } from '@/lib/logger';

const log = createLogger('MCP:Config');

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  disabled?: boolean;
}

export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

const MCP_CONFIG_PATH = path.join(process.cwd(), 'mcp.json');

export function loadMcpConfig(): McpConfigFile {
  try {
    if (!fs.existsSync(MCP_CONFIG_PATH)) {
      return { mcpServers: {} };
    }

    const rawData = fs.readFileSync(MCP_CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(rawData);

    // Basic validation
    if (!parsed || typeof parsed !== 'object' || !parsed.mcpServers) {
      log.warn('Invalid mcp.json structure. Missing mcpServers object.');
      return { mcpServers: {} };
    }

    return parsed as McpConfigFile;
  } catch (error) {
    log.error('Failed to load or parse mcp.json', error);
    return { mcpServers: {} };
  }
}

export function saveMcpConfig(config: McpConfigFile): boolean {
  try {
    fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (error) {
    log.error('Failed to save mcp.json', error);
    return false;
  }
}
