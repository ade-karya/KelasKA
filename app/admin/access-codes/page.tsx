'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, Key, Loader2, PlayCircle, PauseCircle } from 'lucide-react';

export default function AccessCodesPage() {
  const [codes, setCodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCode, setNewCode] = useState('');

  const fetchCodes = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/access-codes');
      const data = await res.json();
      setCodes(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCodes();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode) return;

    try {
      await fetch('/api/admin/access-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: newCode, maxUses: null, expiresAt: null }),
      });
      setNewCode('');
      fetchCodes();
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggle = async (id: string, currentStatus: boolean) => {
    try {
      await fetch(`/api/admin/access-codes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentStatus }),
      });
      fetchCodes();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this access code?')) return;
    try {
      await fetch(`/api/admin/access-codes/${id}`, { method: 'DELETE' });
      fetchCodes();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Access Codes</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2">Manage passcodes for users to access the platform.</p>
        </div>
        
        <form onSubmit={handleCreate} className="flex gap-2">
          <input
            type="text"
            placeholder="New Code (e.g. SUMMER24)"
            value={newCode}
            onChange={e => setNewCode(e.target.value)}
            className="px-4 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 focus:ring-2 focus:ring-blue-500 outline-none"
            required
          />
          <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl flex items-center gap-2 transition-colors">
            <Plus className="w-4 h-4" /> Add
          </button>
        </form>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 overflow-hidden shadow-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-zinc-800/50 text-gray-500 dark:text-gray-400 text-sm">
                <th className="p-4 font-medium border-b border-gray-200 dark:border-zinc-800">Code</th>
                <th className="p-4 font-medium border-b border-gray-200 dark:border-zinc-800">Status</th>
                <th className="p-4 font-medium border-b border-gray-200 dark:border-zinc-800">Usage</th>
                <th className="p-4 font-medium border-b border-gray-200 dark:border-zinc-800">Created At</th>
                <th className="p-4 font-medium border-b border-gray-200 dark:border-zinc-800 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {codes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-gray-500">
                    No access codes found. Create one above.
                  </td>
                </tr>
              ) : (
                codes.map(code => (
                  <tr key={code.id} className="border-b border-gray-100 dark:border-zinc-800/50 hover:bg-gray-50 dark:hover:bg-zinc-800/20 transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-gray-100 dark:bg-zinc-800 rounded-lg">
                          <Key className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                        </div>
                        <span className="font-semibold text-gray-800 dark:text-gray-200">{code.code}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${code.isActive ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400'}`}>
                        {code.isActive ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="p-4 text-gray-600 dark:text-gray-400 text-sm">
                      {code.usageCount} {code.maxUses ? `/ ${code.maxUses}` : '(unlimited)'}
                    </td>
                    <td className="p-4 text-gray-500 dark:text-gray-500 text-sm">
                      {new Date(code.createdAt).toLocaleDateString()}
                    </td>
                    <td className="p-4 text-right space-x-2">
                      <button onClick={() => handleToggle(code.id, code.isActive)} className="p-2 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded-lg text-gray-500 transition-colors" title={code.isActive ? 'Disable' : 'Enable'}>
                        {code.isActive ? <PauseCircle className="w-5 h-5 text-amber-500" /> : <PlayCircle className="w-5 h-5 text-green-500" />}
                      </button>
                      <button onClick={() => handleDelete(code.id)} className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg text-red-500 transition-colors" title="Delete">
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
