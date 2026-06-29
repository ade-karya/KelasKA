'use client';

import { useEffect, useState } from 'react';
import { Settings, Save, Loader2 } from 'lucide-react';

export default function ProvidersPage() {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/providers');
      const data = await res.json();
      setConfig(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await fetch('/api/admin/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      setMessage('Settings saved successfully.');
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      console.error(err);
      setMessage('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[500px] items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-3">
          <Settings className="w-8 h-8 text-blue-600" />
          Providers & Features
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2">Configure AI model providers and toggle system features.</p>
      </div>

      <form onSubmit={handleSave} className="space-y-8">
        {/* Feature Toggles */}
        <section className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-800">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-6 border-b border-gray-100 dark:border-zinc-800 pb-4">Feature Toggles</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {Object.entries(config?.featureToggles || {}).map(([key, value]) => (
              <label key={key} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-zinc-800/50 rounded-xl cursor-pointer hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors">
                <span className="font-medium text-gray-700 dark:text-gray-200">
                  {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                </span>
                <input
                  type="checkbox"
                  checked={value as boolean}
                  onChange={(e) => setConfig({
                    ...config,
                    featureToggles: {
                      ...config.featureToggles,
                      [key]: e.target.checked
                    }
                  })}
                  className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              </label>
            ))}
          </div>
        </section>

        {/* API Keys */}
        <section className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-800">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-6 border-b border-gray-100 dark:border-zinc-800 pb-4">API Keys</h2>
          
          <div className="space-y-4">
            {['openai', 'google', 'anthropic'].map((provider) => (
              <div key={provider} className="flex flex-col space-y-2">
                <label className="font-medium text-gray-700 dark:text-gray-300 capitalize">{provider} API Key</label>
                <input
                  type="password"
                  value={config?.apiKeys?.[provider] || ''}
                  onChange={(e) => setConfig({
                    ...config,
                    apiKeys: {
                      ...config.apiKeys,
                      [provider]: e.target.value
                    }
                  })}
                  placeholder={`Optional (Falls back to env var if empty)`}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            ))}
          </div>
        </section>

        <div className="flex items-center gap-4 pb-12">
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl flex items-center gap-2 font-medium transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            Save Settings
          </button>
          
          {message && (
            <span className="text-green-600 dark:text-green-400 font-medium">{message}</span>
          )}
        </div>
      </form>
    </div>
  );
}
