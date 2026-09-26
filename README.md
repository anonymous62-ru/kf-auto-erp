# KF Auto ERP — Squelette de démarrage

Ce projet correspond à l'architecture décrite dans les 10 phases de conception
(analyse métier, base de données, Supabase/rôles, UI, offline-first, PDF, envoi/paiements,
dashboard, roadmap, sécurité).

## Démarrage

1. `npm install`
2. Copier `.env.example` en `.env.local` et renseigner les clés Supabase
3. Créer un projet Supabase, puis exécuter le schéma SQL complet (fourni en Phase 2 du projet :
   `kf-auto-erp-phase2-database.sql`) dans l'éditeur SQL Supabase ou via `supabase db push`
4. `npm run dev`

## Ce qui est déjà en place dans ce squelette
- Authentification Supabase (login + middleware de protection des routes)
- Client Supabase navigateur + serveur (`lib/supabase/`)
- Base locale offline avec Dexie.js et file de synchronisation de base (`lib/offline/db.ts`)
- Calculs de totaux de documents partagés client/serveur (`lib/documents/calculations.ts`)
- Dashboard et liste clients de démonstration, qui héritent automatiquement du RLS
  (aucun filtre manuel nécessaire côté code — la base ne retourne que ce que le rôle autorise)

## Ce qu'il reste à construire
Tout le détail se trouve dans les documents de conception phase par phase :
formulaire de création de document complet, signature tactile, génération PDF
(`@react-pdf/renderer`, modèle fourni en Phase 6), moteur de synchronisation complet,
envoi multicanal, module stock, paiements, dashboard avancé.

## Stack
Next.js 15 (App Router) · TypeScript · Tailwind CSS · Supabase (Auth/Postgres/Storage) ·
Dexie.js (IndexedDB) · @react-pdf/renderer
