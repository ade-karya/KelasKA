'use client';

import { useState } from 'react';
import { UserProviderConfig, ProviderCategory } from '@/lib/types/admin';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Eye, EyeOff, Loader2, Save, Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';

interface ProviderConfigFormProps {
  userId: string;
  category: ProviderCategory;
  configs: UserProviderConfig[];
  availableProviders: { id: string; name: string }[];
  onSaved: () => void;
}

export function ProviderConfigForm({
  userId,
  category,
  configs: initialConfigs,
  availableProviders,
  onSaved,
}: ProviderConfigFormProps) {
  const [configs, setConfigs] = useState<Partial<UserProviderConfig>[]>(
    initialConfigs.filter((c) => c.category === category)
  );
  const [loading, setLoading] = useState(false);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  const toggleKey = (idx: number) => {
    setShowKey((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const updateConfig = (idx: number, field: keyof UserProviderConfig, value: any) => {
    const newConfigs = [...configs];
    newConfigs[idx] = { ...newConfigs[idx], [field]: value };
    setConfigs(newConfigs);
  };

  const removeConfig = (idx: number) => {
    setConfigs(configs.filter((_, i) => i !== idx));
  };

  const addConfig = () => {
    // Default to first available provider not already used
    const usedProviders = new Set(configs.map((c) => c.provider_id));
    const available = availableProviders.find((p) => !usedProviders.has(p.id)) || availableProviders[0];
    
    if (available) {
      setConfigs([
        ...configs,
        {
          category,
          provider_id: available.id,
          api_key: '',
          base_url: '',
          is_enabled: true,
          models: [],
        },
      ]);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      // First, get ALL configs for this user so we don't overwrite other categories
      const resAll = await fetch(`/api/admin/users/${userId}/configs`);
      const { configs: allConfigs } = await resAll.json();
      
      const otherCategoryConfigs = (allConfigs || []).filter(
        (c: UserProviderConfig) => c.category !== category
      );

      // Merge other categories with our updated category
      const mergedConfigs = [...otherCategoryConfigs, ...configs];

      const res = await fetch(`/api/admin/users/${userId}/configs`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configs: mergedConfigs }),
      });

      if (res.ok) {
        toast.success('Configuration saved');
        onSaved();
      } else {
        toast.error('Failed to save configuration');
      }
    } catch {
      toast.error('Failed to save configuration');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {configs.length === 0 ? (
        <Card className="p-8 border-dashed border-white/20 bg-transparent flex flex-col items-center justify-center text-center">
          <p className="text-slate-400 mb-4">No providers configured for this category.</p>
          <Button onClick={addConfig} variant="outline" className="bg-white/5 border-white/10 text-white hover:bg-white/10">
            <Plus className="mr-2 h-4 w-4" /> Add Provider
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {configs.map((config, idx) => (
            <Card key={idx} className="p-6 bg-white/5 border-white/10 backdrop-blur-xl relative group">
              <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-slate-500 hover:text-rose-400 hover:bg-rose-500/10"
                  onClick={() => removeConfig(idx)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-slate-300">Provider</Label>
                  <Select
                    value={config.provider_id}
                    onValueChange={(val) => updateConfig(idx, 'provider_id', val)}
                  >
                    <SelectTrigger className="bg-black/20 border-white/10 text-white w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-white/10">
                      {availableProviders.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-slate-300">Status</Label>
                  </div>
                  <div className="flex items-center space-x-2 h-10">
                    <Switch
                      checked={config.is_enabled}
                      onCheckedChange={(val) => updateConfig(idx, 'is_enabled', val)}
                    />
                    <span className="text-sm text-slate-400">
                      {config.is_enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">API Key</Label>
                  <div className="relative">
                    <Input
                      type={showKey[idx] ? 'text' : 'password'}
                      value={config.api_key || ''}
                      onChange={(e) => updateConfig(idx, 'api_key', e.target.value)}
                      placeholder="sk-..."
                      className="bg-black/20 border-white/10 text-white placeholder:text-slate-500 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => toggleKey(idx)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      {showKey[idx] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">Base URL (Optional)</Label>
                  <Input
                    type="url"
                    value={config.base_url || ''}
                    onChange={(e) => updateConfig(idx, 'base_url', e.target.value)}
                    placeholder="https://api..."
                    className="bg-black/20 border-white/10 text-white placeholder:text-slate-500"
                  />
                </div>
              </div>
            </Card>
          ))}
          
          <Button onClick={addConfig} variant="outline" className="w-full bg-white/5 border-dashed border-white/20 text-slate-300 hover:text-white hover:bg-white/10">
            <Plus className="mr-2 h-4 w-4" /> Add Another Provider
          </Button>
        </div>
      )}

      <div className="flex justify-end pt-4 border-t border-white/10">
        <Button
          onClick={handleSave}
          className="bg-violet-600 hover:bg-violet-700 text-white"
          disabled={loading || configs.length === 0}
        >
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Changes
        </Button>
      </div>
    </div>
  );
}
