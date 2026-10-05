'use client';

// Petit badge dans l'en-tete : indique clairement au commercial s'il est
// hors-ligne et combien d'elements attendent d'etre envoyes au serveur.
// C'est la seule chose qui doit le rassurer : "ton travail n'est pas perdu".
import { useEffect, useState } from 'react';
import { countPending } from '@/lib/offline/db';
import { runSync } from '@/lib/offline/sync';
import { SYNC_EVENT } from '@/components/offline/sync-provider';

export function OfflineStatusBadge() {
  const [isOnline, setIsOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setIsOnline(navigator.onLine);

    async function refresh() {
      setPending(await countPending());
    }
    void refresh();

    function handleOnline() {
      setIsOnline(true);
      void refresh();
    }
    function handleOffline() {
      setIsOnline(false);
    }
    function handleSyncUpdated() {
      void refresh();
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener(SYNC_EVENT, handleSyncUpdated);
    const interval = setInterval(refresh, 15_000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener(SYNC_EVENT, handleSyncUpdated);
      clearInterval(interval);
    };
  }, []);

  async function handleManualSync() {
    setSyncing(true);
    await runSync();
    setPending(await countPending());
    setSyncing(false);
  }

  if (isOnline && pending === 0) {
    return (
      <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-gray-500">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Synchronisé
      </span>
    );
  }

  return (
    <button
      onClick={handleManualSync}
      disabled={!isOnline || syncing}
      className={`text-xs px-2 py-1 rounded-md border flex items-center gap-1.5 font-medium ${
        isOnline ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-700'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-amber-500' : 'bg-red-500'}`} />
      {!isOnline ? 'Hors ligne' : syncing ? 'Synchro...' : `${pending} en attente`}
    </button>
  );
}
