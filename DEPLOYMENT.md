# Déploiement en production — KF Auto ERP

## 0. Pour un essai en ligne, gratuitement (avant l'achat)

Tout ce qu'il faut pour un essai réel en ligne (accessible depuis n'importe quel téléphone, pas seulement en local) est **déjà gratuit**, sans rien payer :

- **Vercel** (héberge l'app Next.js) : plan **Hobby**, gratuit, suffisant pour un essai (voire pour un usage réel modéré).
- **Supabase** (base de données/authentification/stockage) : le projet est déjà sur le plan gratuit — rien à changer.

Étapes pour mettre en ligne l'essai (~10 minutes) :

1. Créer un compte gratuit sur [vercel.com](https://vercel.com) (avec GitHub, le plus simple).
2. Pousser le code du projet sur un dépôt GitHub (créer un dépôt vide, puis `git init` + `git remote add` + `git push` depuis le dossier du projet).
3. Sur Vercel, "Add New Project" → importer ce dépôt.
4. Dans "Environment Variables", coller les 3 valeurs du fichier `.env.local` fourni (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
5. Cliquer "Deploy". Après ~2 minutes, Vercel donne une URL du type `kf-auto-erp-xxxx.vercel.app`, utilisable immédiatement depuis n'importe quel appareil.

Seule limite du plan gratuit Supabase à connaître pendant l'essai : le projet se **met en pause après 7 jours sans aucune activité** (il suffit d'ouvrir l'app une fois pour le "réveiller", sans perte de données) — pas un problème pour tester, mais à passer sur le plan payant (voir section 6) avant un vrai lancement commercial pour l'utiliser sans interruption.

## 1. Hébergement recommandé

- **Application (Next.js)** : Vercel (gratuit pour démarrer, scalable ensuite). Next.js 15 y est nativement supporté, aucune configuration particulière (`vercel.json`) n'est nécessaire.
- **Backend** : déjà sur Supabase (Postgres + Auth + Storage), aucun changement nécessaire au passage en production.

## 2. Avant de déployer

- [ ] Passer le projet Supabase sur le plan **Pro** (25$/mois) avant le vrai lancement commercial : le plan gratuit met le projet en pause après 7 jours d'inactivité, ce qui casserait l'app pour tout le monde.
- [ ] Vérifier qu'aucune policy RLS "de test" trop permissive ne traîne (`select * using (true)` par exemple).
- [ ] Vérifier que tous les buckets Storage (`document-signatures`, `org-branding`) ont des policies cohérentes avec leur usage réel.

## 3. Déployer sur Vercel

1. Pousser le code sur un dépôt Git (GitHub/GitLab) — ou utiliser `vercel --prod` en local si vous préférez ne pas utiliser Git.
2. Sur [vercel.com](https://vercel.com), importer le projet.
3. Renseigner les variables d'environnement (Project Settings → Environment Variables), les **mêmes** que dans `.env.local` :
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (⚠️ à cocher uniquement pour l'environnement serveur, jamais exposée au navigateur — Vercel le fait automatiquement pour les variables sans préfixe `NEXT_PUBLIC_`)
4. Déployer. Vercel donne une URL du type `kf-auto-erp.vercel.app`.
5. (Optionnel mais recommandé) Brancher un domaine personnalisé, par ex. `app.kfauto.tg`, dans Project Settings → Domains.

## 4. Ce qui s'adapte automatiquement

- Le **QR code de vérification** sur chaque PDF utilise l'URL du serveur qui génère le document (`req.nextUrl.origin`) — aucune configuration à changer, il pointera automatiquement vers votre domaine de production dès le déploiement.
- Le **manifeste PWA** (`public/manifest.json`) et le **service worker** (`public/sw.js`) fonctionnent tels quels sur n'importe quel domaine HTTPS (Vercel fournit HTTPS automatiquement).

## 5. Après le déploiement

- [ ] Tester le parcours complet (chemin d'or) depuis un vrai smartphone, en conditions réelles de réseau
- [ ] Vérifier que l'app est bien "installable" (icône "Ajouter à l'écran d'accueil" sur Chrome/Safari mobile)
- [ ] Créer les comptes des commerciaux réels via `/users` (plus besoin d'accès direct à Supabase)
- [ ] Programmer une sauvegarde régulière de la base (Supabase Pro le fait automatiquement, mais vérifier la fréquence dans Project Settings → Database → Backups)

## 6. Coûts estimés (démarrage, une seule organisation)

| Poste | Coût mensuel estimé |
|---|---|
| Vercel (plan Hobby, suffisant au départ) | 0 $ |
| Supabase (plan Pro, recommandé dès le lancement réel) | 25 $ |
| Nom de domaine (si custom) | ~1 $/mois (annuel) |
| **Total** | **~26 $/mois** |

Ce coût reste stable jusqu'à un volume d'usage assez élevé (des dizaines de commerciaux, plusieurs milliers de documents/mois) avant qu'un palier supérieur soit nécessaire.
