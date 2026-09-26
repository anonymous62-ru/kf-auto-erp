'use client';

// Monte une seule fois (dans le layout de l'app). Responsable de :
// - enregistrer le service worker (app installable / shell disponible hors-ligne)
// - mettre en cache le profil + le catalogue des que possible
// - synchroniser la file d'attente locale des que le reseau revient
import { useEffect } from 'react';
import { refreshCachedProfile } from '@/lib/offline/profile';
import { prefetchCatalog } from '@/lib/offline/cache';
import { runSync } from '@/lib/offline/sync';
import { checkOverdueReminders } from '@/lib/payments/actions';

export const SYNC_EVENT = 'kf-sync-updated';

function notifySyncUpdated() {
  window.dispatchEvent(new Event(SYNC_EVENT));
}

async function bootstrapAndSync() {
  await refreshCachedProfile();
  await prefetchCatalog();
  await runSync();
  // Relances de paiement : vérif légère (une requête RPC), pas besoin de
  // tâche planifiée côté serveur — se déclenche au chargement, au retour
  // en ligne, et toutes les 2 minutes tant que l'app reste ouverte.
  checkOverdueReminders().catch(() => {});
  notifySyncUpdated();
}

export function SyncProvider() {
  useEffect(() => {
    // Le service worker met en cache les fichiers JS/CSS de l'app — utile en
    // production, mais catastrophique en développement : il sert de vieux
    // fichiers mis en cache après chaque recompilation du serveur (Fast
    // Refresh), ce qui provoque des erreurs "module introuvable" qui
    // persistent même après un redémarrage complet du serveur. On ne
    // l'active donc qu'en production.
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // l'app reste utilisable sans SW, juste sans cache d'app-shell hors-ligne
      });
    } else if (process.env.NODE_ENV !== 'production' && 'serviceWorker' in navigator) {
      // Nettoie un éventuel service worker + cache resté actif d'une session
      // précédente (avant ce correctif), pour s'auto-réparer sans manipulation
      // manuelle dans les DevTools.
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((r) => r.unregister());
      });
      if ('caches' in window) {
        caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
      }
    }

    void bootstrapAndSync();

    function handleOnline() {
      void bootstrapAndSync();
    }
    window.addEventListener('online', handleOnline);

    // filet de securite : retente toutes les 2 minutes si des elements
    // restent en erreur (ex: RLS transitoire) pendant que l'app est ouverte
    const interval = setInterval(() => {
      if (navigator.onLine) void bootstrapAndSync();
    }, 120_000);

    return () => {
      window.removeEventListener('online', handleOnline);
      clearInterval(interval);
    };
  }, []);

  return null;
}
