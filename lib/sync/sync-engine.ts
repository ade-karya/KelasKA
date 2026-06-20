/**
 * KelasKA Sync Engine
 * 
 * Local-first bidirectional sync between Dexie (IndexedDB) and Supabase.
 * - All reads/writes go to Dexie first (instant, offline-capable)
 * - Changes are queued and pushed to Supabase when online
 * - Remote changes are pulled periodically + via Realtime subscriptions
 * - Conflict resolution: Last-Write-Wins (LWW) based on updatedAt
 */

import { db } from '@/lib/utils/database';
import type { StageRecord, SceneRecord, ChatSessionRecord } from '@/lib/utils/database';
import { createLogger } from '@/lib/logger';

const log = createLogger('SyncEngine');

// Tables that participate in sync (excluding blob-heavy + session-only tables)
const SYNCABLE_TABLES = [
  'stages', 'scenes', 'chatSessions', 'generatedAgents',
  'stageOutlines', 'playbackState', 'voiceProfiles',
] as const;

type SyncableTable = typeof SYNCABLE_TABLES[number];

interface SyncQueueItem {
  id: string;
  table: SyncableTable;
  operation: 'put' | 'delete';
  data?: Record<string, unknown>;
  timestamp: number;
}

interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncAt: number | null;
  pendingChanges: number;
  error: string | null;
}

export class SyncEngine {
  private status: SyncStatus = {
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    isSyncing: false,
    lastSyncAt: null,
    pendingChanges: 0,
    error: null,
  };
  
  private syncQueue: SyncQueueItem[] = [];
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<(status: SyncStatus) => void> = new Set();
  private supabaseClient: any = null;
  
  constructor() {
    if (typeof window !== 'undefined') {
      // Listen for online/offline events
      window.addEventListener('online', () => this.handleOnline());
      window.addEventListener('offline', () => this.handleOffline());
    }
  }
  
  /** Initialize with Supabase client */
  async init(supabaseClient: any) {
    this.supabaseClient = supabaseClient;
    
    // Load pending queue from IndexedDB/localStorage
    await this.loadPendingQueue();
    
    if (typeof window !== 'undefined') {
      // Start periodic sync (every 30 seconds when online)
      this.syncInterval = setInterval(() => {
        if (this.status.isOnline && !this.status.isSyncing) {
          this.sync().catch(err => log.error('Periodic sync failed:', err));
        }
      }, 30_000);
    }
    
    // Initial sync
    if (this.status.isOnline) {
      this.sync().catch(err => log.error('Initial sync failed:', err));
    }
    
    log.info('SyncEngine initialized');
  }
  
  /** Queue a local change for sync */
  async queueChange(table: SyncableTable, operation: 'put' | 'delete', id: string, data?: any) {
    const item: SyncQueueItem = {
      id, table, operation,
      data: operation === 'put' ? data : undefined,
      timestamp: Date.now(),
    };
    
    // Deduplicate: remove older entries for same table+id
    this.syncQueue = this.syncQueue.filter(
      q => !(q.table === table && q.id === id)
    );
    this.syncQueue.push(item);
    
    await this.persistQueue();
    this.updateStatus({ pendingChanges: this.syncQueue.length });
    
    // Try immediate push if online
    if (this.status.isOnline && !this.status.isSyncing) {
      this.sync().catch(() => {});
    }
  }
  
  /** Full bidirectional sync */
  async sync() {
    if (!this.supabaseClient || this.status.isSyncing) return;
    
    this.updateStatus({ isSyncing: true, error: null });
    
    try {
      // 1. Push local changes to Supabase
      await this.pushChanges();
      
      // 2. Pull remote changes from Supabase
      await this.pullChanges();
      
      this.updateStatus({
        isSyncing: false,
        lastSyncAt: Date.now(),
        pendingChanges: this.syncQueue.length,
      });
      
      log.info('Sync completed successfully');
    } catch (err: any) {
      this.updateStatus({
        isSyncing: false,
        error: err.message || 'Sync failed',
      });
      log.error('Sync failed:', err);
    }
  }
  
  /** Push queued local changes to Supabase */
  private async pushChanges() {
    const queue = [...this.syncQueue];
    const succeeded: SyncQueueItem[] = [];
    
    for (const item of queue) {
      try {
        const tableName = `synced_${this.toSnakeCase(item.table)}`;
        
        if (item.operation === 'put' && item.data) {
          const { error } = await this.supabaseClient
            .from(tableName)
            .upsert(this.toSnakeCaseKeys(item.data), { onConflict: 'id' });
          if (error) throw error;
        } else if (item.operation === 'delete') {
          // Soft delete
          const { error } = await this.supabaseClient
            .from(tableName)
            .update({ deleted_at: Date.now() })
            .eq('id', item.id);
          if (error) throw error;
        }
        
        succeeded.push(item);
      } catch (err) {
        log.warn(`Failed to push ${item.table}/${item.id}:`, err);
      }
    }
    
    // Remove succeeded items from queue
    this.syncQueue = this.syncQueue.filter(q => !succeeded.includes(q));
    await this.persistQueue();
  }
  
  /** Pull remote changes from Supabase (since last sync) */
  private async pullChanges() {
    const since = this.status.lastSyncAt || 0;
    
    for (const table of SYNCABLE_TABLES) {
      try {
        const tableName = `synced_${this.toSnakeCase(table)}`;
        const { data, error } = await this.supabaseClient
          .from(tableName)
          .select('*')
          .gt('updated_at', since)
          .order('updated_at', { ascending: true });
        
        if (error) throw error;
        if (!data || data.length === 0) continue;
        
        // Apply remote changes to local Dexie (LWW)
        const dexieTable = db.table(table);
        
        for (const remoteRow of data) {
          const localRow = await dexieTable.get(remoteRow.id);
          const remoteUpdated = remoteRow.updated_at || remoteRow.updatedAt;
          const localUpdated = localRow?.updatedAt || 0;
          
          if (remoteRow.deleted_at) {
            // Remote deleted — delete local
            await dexieTable.delete(remoteRow.id);
          } else if (remoteUpdated > localUpdated) {
            // Remote is newer — update local (LWW)
            const localData = this.toCamelCaseKeys(remoteRow);
            delete localData.userId;
            delete localData.deletedAt;
            await dexieTable.put(localData);
          }
          // If local is newer, our push will handle it
        }
        
        log.info(`Pulled ${data.length} changes from ${tableName}`);
      } catch (err) {
        log.warn(`Failed to pull ${table}:`, err);
      }
    }
  }
  
  // ─── Helpers ────────────────────────────────────────────────
  private handleOnline() {
    this.updateStatus({ isOnline: true });
    log.info('Back online — starting sync');
    this.sync().catch(() => {});
  }
  
  private handleOffline() {
    this.updateStatus({ isOnline: false });
    log.info('Gone offline — changes will be queued');
  }
  
  private async loadPendingQueue() {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('kelaska_sync_queue');
      if (stored) {
        try {
          this.syncQueue = JSON.parse(stored);
          this.updateStatus({ pendingChanges: this.syncQueue.length });
        } catch(e) {
          log.error('Failed to parse sync queue', e);
        }
      }
    }
  }
  
  private async persistQueue() {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('kelaska_sync_queue', JSON.stringify(this.syncQueue));
    }
  }
  
  private updateStatus(partial: Partial<SyncStatus>) {
    this.status = { ...this.status, ...partial };
    this.listeners.forEach(fn => fn(this.status));
  }
  
  subscribe(fn: (status: SyncStatus) => void) {
    this.listeners.add(fn);
    fn(this.status); // Immediate callback
    return () => this.listeners.delete(fn);
  }
  
  getStatus(): SyncStatus { return { ...this.status }; }
  
  destroy() {
    if (this.syncInterval) clearInterval(this.syncInterval);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', () => this.handleOnline());
      window.removeEventListener('offline', () => this.handleOffline());
    }
  }
  
  // Key conversion utilities
  private toSnakeCase(str: string): string {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase();
  }
  private toSnakeCaseKeys(obj: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[this.toSnakeCase(key)] = val;
    }
    return result;
  }
  private toCamelCaseKeys(obj: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, val] of Object.entries(obj)) {
      const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      result[camel] = val;
    }
    return result;
  }
}

// Singleton
export const syncEngine = new SyncEngine();
