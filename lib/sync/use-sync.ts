'use client';

import { useState, useEffect } from 'react';
import { syncEngine } from './sync-engine';

export function useSync() {
  const [status, setStatus] = useState(syncEngine.getStatus());
  
  useEffect(() => {
    const unsubscribe = syncEngine.subscribe(setStatus);
    return () => { unsubscribe(); };
  }, []);
  
  return {
    ...status,
    triggerSync: () => syncEngine.sync(),
  };
}
