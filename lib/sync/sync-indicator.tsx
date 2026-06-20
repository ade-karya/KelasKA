'use client';

import { useSync } from './use-sync';
import { syncEngine } from './sync-engine';

export function SyncIndicator() {
  const { isOnline, isSyncing, pendingChanges, lastSyncAt, error } = useSync();
  
  // Hanya tampil di desktop mode
  if (typeof window === 'undefined' || !(window as any).electronAPI?.isDesktop) {
    return null;
  }
  
  const statusColor = error ? '#ef4444' 
    : !isOnline ? '#f59e0b' 
    : isSyncing ? '#3b82f6' 
    : '#22c55e';
  
  const statusText = error ? 'Sync Error'
    : !isOnline ? `Offline (${pendingChanges} pending)`
    : isSyncing ? 'Syncing...'
    : 'Synced';
  
  return (
    <div 
      className="sync-indicator" 
      title={`${statusText}${lastSyncAt ? `\nLast sync: ${new Date(lastSyncAt).toLocaleTimeString()}` : ''}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '4px 10px', borderRadius: '12px',
        fontSize: '12px', color: '#94a3b8',
        background: 'rgba(255,255,255,0.05)',
        cursor: 'pointer',
      }}
      onClick={() => syncEngine.sync()}
    >
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        backgroundColor: statusColor,
        animation: isSyncing ? 'pulse 1s infinite' : undefined,
      }} />
      {statusText}
    </div>
  );
}
