'use client';

import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { Loader2, CheckCircle2, XCircle, Eye, EyeOff, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

export function CanvaSettings() {
  const { t } = useI18n();

  const canvaConfig = useSettingsStore((state) => state.canvaConfig);
  const setCanvaConfig = useSettingsStore((state) => state.setCanvaConfig);

  const [showToken, setShowToken] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  const handleTest = async () => {
    setTestLoading(true);
    setTestStatus('idle');
    setTestMessage('');
    try {
      const response = await fetch('/api/verify-canva', {
        method: 'POST',
        headers: {
          'x-canva-token': canvaConfig.token || '',
          'x-canva-base-url': canvaConfig.baseUrl || '',
        },
      });
      const data = await response.json();
      if (data.success) {
        setTestStatus('success');
        setTestMessage(data.message || t('settings.imageConnectivitySuccess'));
      } else {
        setTestStatus('error');
        setTestMessage(`${t('settings.imageConnectivityFailed')}: ${data.message}`);
      }
    } catch (err) {
      setTestStatus('error');
      setTestMessage(`${t('settings.imageConnectivityFailed')}: ${err}`);
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="rounded-lg border border-border bg-muted/30 p-4 mb-4">
        <h3 className="font-medium text-sm mb-2">{t('settings.canvaIntegrationNote') || 'Canva API Requires OAuth Bearer Token'}</h3>
        <p className="text-sm text-muted-foreground">
          {t('settings.canvaIntegrationDesc') || 'Canva requires a Bearer Token for authentication. Enter your token below. This integration utilizes Canva Design Autofill API which requires a Canva Enterprise account.'}
        </p>
      </div>

      {/* Bearer Token */}
      <div className="space-y-2">
        <Label>Bearer Token</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              name="canva-token"
              type={showToken ? 'text' : 'password'}
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5c..."
              value={canvaConfig.token || ''}
              onChange={(e) => setCanvaConfig({ token: e.target.value })}
              className="h-8 pr-8"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testLoading || !canvaConfig.token}
            className="gap-1.5"
          >
            {testLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Zap className="h-3.5 w-3.5" />
                {t('settings.testConnection')}
              </>
            )}
          </Button>
        </div>
        {testMessage && (
          <div
            className={cn(
              'rounded-lg p-3 text-sm overflow-hidden',
              testStatus === 'success' &&
                'bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/50 dark:text-green-400 dark:border-green-800',
              testStatus === 'error' &&
                'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800',
            )}
          >
            <div className="flex items-start gap-2 min-w-0">
              {testStatus === 'success' && <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />}
              {testStatus === 'error' && <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
              <p className="flex-1 min-w-0 break-all">{testMessage}</p>
            </div>
          </div>
        )}
      </div>

      {/* Base URL */}
      <div className="space-y-2">
        <Label>Base URL</Label>
        <Input
          name="canva-base-url"
          type="url"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={canvaConfig.baseUrl || ''}
          onChange={(e) => setCanvaConfig({ baseUrl: e.target.value })}
          placeholder="https://api.canva.com/rest"
          className="h-8"
        />
        <p className="text-xs text-muted-foreground break-all">
          Default: https://api.canva.com/rest 
        </p>
      </div>

      {/* Brand Template ID */}
      <div className="space-y-2">
        <Label>Brand Template ID</Label>
        <Input
          name="canva-template-id"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={canvaConfig.brandTemplateId || ''}
          onChange={(e) => setCanvaConfig({ brandTemplateId: e.target.value })}
          placeholder="e.g. AEN3TrQftXo"
          className="h-8"
        />
        <p className="text-xs text-muted-foreground break-all">
          ID of the Canva Brand Template to use for autofill.
        </p>
      </div>

      {/* Export Format */}
      <div className="space-y-2">
        <Label>Export Format</Label>
        <Select
          value={canvaConfig.exportFormat}
          onValueChange={(val: 'png' | 'jpg') => setCanvaConfig({ exportFormat: val })}
        >
          <SelectTrigger className="w-[180px] h-8">
            <SelectValue placeholder="Format" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="png">PNG</SelectItem>
            <SelectItem value="jpg">JPG</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
