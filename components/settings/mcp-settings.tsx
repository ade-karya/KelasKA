'use client';

import { useState, useEffect } from 'react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { Switch } from '@/components/ui/switch';
import { Loader2, Server, TerminalSquare, AlertCircle } from 'lucide-react';

interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  disabled?: boolean;
}

interface McpConfigPayload {
  mcpServers: Record<string, McpServerConfig>;
}

export function McpSettings() {
  const { t } = useI18n();
  const [config, setConfig] = useState<McpConfigPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null); // Track which server is saving

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/mcp-config');
      const data = await res.json();
      if (data.success && data.config) {
        setConfig(data.config);
      } else {
        throw new Error(data.message || 'Failed to fetch MCP config');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (serverName: string, currentlyDisabled: boolean) => {
    setSaving(serverName);
    try {
      const res = await fetch('/api/mcp-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverName, disabled: !currentlyDisabled })
      });
      const data = await res.json();
      if (data.success && data.config) {
        setConfig(data.config);
      } else {
        throw new Error(data.message || 'Failed to update MCP server');
      }
    } catch (err: any) {
      alert(`Error updating server: ${err.message}`);
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex bg-red-50 text-red-700 p-4 rounded-lg items-center gap-3">
        <AlertCircle className="h-5 w-5" />
        <p className="text-sm font-medium">{error}</p>
      </div>
    );
  }

  const servers = Object.entries(config?.mcpServers || {});

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="rounded-lg border border-border bg-muted/30 p-4 mb-4">
        <h3 className="font-medium text-sm mb-2">{t('settings.mcpIntegrationNote') || 'Model Context Protocol (MCP)'}</h3>
        <p className="text-sm text-muted-foreground">
          {t('settings.mcpIntegrationDesc') || 'Manage external MCP Subprocess Servers. Enabling a server allows the AI to automatically utilize its tools during generation. Configure server profiles in your project root\'s mcp.json file.'}
        </p>
      </div>

      {servers.length === 0 ? (
        <div className="text-center p-8 border rounded-lg border-dashed">
          <Server className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-medium">No MCP Servers Found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Add MCP servers configuration to your <code>mcp.json</code> file at the project root.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {servers.map(([name, conf]) => {
            const isEnabled = !conf.disabled;
            const isSaving = saving === name;

            return (
              <div 
                key={name}
                className={`p-4 rounded-lg border flex items-start justify-between transition-colors ${isEnabled ? 'bg-card border-border' : 'bg-muted/30 border-dashed'}`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium">{name}</h4>
                    {!isEnabled && (
                      <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-semibold">
                        Disabled
                      </span>
                    )}
                  </div>
                  <div className="flex items-center text-xs text-muted-foreground gap-1.5 font-mono bg-muted/50 w-fit px-2 py-1 rounded">
                    <TerminalSquare className="h-3 w-3" />
                    {conf.command} {conf.args?.join(' ')}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2 ml-4">
                  {isSaving ? (
                     <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : (
                    <Switch 
                      checked={isEnabled} 
                      onCheckedChange={() => handleToggle(name, !isEnabled)} 
                      aria-label="Toggle MCP Server"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
