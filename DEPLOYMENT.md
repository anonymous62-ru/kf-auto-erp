# Déploiement en production, KF Auto ERP

## 0. Pour un essai en ligne, gratuitement (avant l'achat)

Tout ce qu'il faut pour un essai réel en ligne (accessible depuis n'importe quel téléphone, pas seulement en local) est **déjà gratuit**, sans rien payer :

- **Vercel** (héberge l'app Next.js) : plan **Hobby**, gratuit, suffisant pour un essai (voire pour un usage réel modéré).
- **Supabase** (base de données/authentification/stockage) : le projet est déjà sur le plan gratuit, rien à changer.

Étapes pour mettre en ligne l'essai (~10 minutes) :

1. Créer un compte gratuit sur [vercel.com](https://vercel.com) (avec GitHub, le plus simple).
2. Pousser le code du projet sur un dépôt GitHub (créer un dépôt vide, puis `git init` + `git remote add` + `git push` depuis le dossier du projet).
3. Sur Vercel, "Add New Project" → importer ce dépôt.
4. Dans "Environment Variables", coller les 3 valeurs du fichier `.env.local` fourni (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
5. Cliquer "Deploy". Après ~2 minutes, Vercel donne une URL du type `kf-auto-erp-xxxx.vercel.app`, utilisable immédiatement depuis n'importe quel appareil.

Seule limite du plan gratuit Supabase à connaître pendant l'essai : le projet se **met en pause après 7 jours sans aucune activité** (il suffit d'ouvrir l'app une fois pour le "réveiller", sans perte de données), pas un problème pour tester, mais à passer sur le plan payant (voir section 6) avant un vrai lancement commercial pour l'utiliser sans interruption.

## 1. Hébergement recommandé

- **Application (Next.js)** : Vercel (gratuit pour démarrer, scalable ensuite). Next.js 15 y est nativement supporté, aucune configuration particulière (`vercel.json`) n'est nécessaire.
- **Backend** : déjà sur Supabase (Postgres + Auth + Storage), aucun changement nécessaire au passage en production.

## 2. Avant de déployer

- [ ] Passer le projet Supabase sur le plan **Pro** (25$/mois) avant le vrai lancement commercial : le plan gratuit met le projet en pause après 7 jours d'inactivité, ce qui casserait l'app pour tout le monde.
- [ ] Vérifier qu'aucune policy RLS "de test" trop permissive ne traîne (`select * using (true)` par exemple).
- [ ] Vérifier que tous les buckets Storage (`document-signatures`, `org-branding`) ont des policies cohérentes avec leur usage réel.

## 3. Déployer sur Vercel

1. Pousser le code sur un dépôt Git (GitHub/GitLab), ou utiliser `vercel --prod` en local si vous préférez ne pas utiliser Git.
2. Sur [vercel.com](https://vercel.com), importer le projet.
3. Renseigner les variables d'environnement (Project Settings → Environment Variables), les **mêmes** que dans `.env.local` :
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (à cocher uniquement pour l'environnement serveur, jamais exposée au navigateur, Vercel le fait automatiquement pour les variables sans préfixe `NEXT_PUBLIC_`)
4. Déployer. Vercel donne une URL du type `kf-auto-erp.vercel.app`.
5. (Optionnel mais recommandé) Brancher un domaine personnalisé, par ex. `app.kfauto.tg`, dans Project Settings → Domains.

## 4. Ce qui s'adapte automatiquement

- Le **QR code de vérification** sur chaque PDF utilise l'URL du serveur qui génère le document (`req.nextUrl.origin`), aucune configuration à changer, il pointera automatiquement vers votre domaine de production dès le déploiement.
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

## 7. E-mails de notification (actions à valider)

Chaque action à valider (proforma, bon de commande, facture, paiement, échéance, demande de compte) crée une notification dans la cloche et un e-mail mis en file dans la base (table `email_outbox`). L'application envoie ensuite ces e-mails via **Resend**, depuis `notifications@kfauto.tg`. Tant que la configuration ci-dessous n'est pas faite, rien n'est perdu : les e-mails restent « en attente » et partent dès que la clé est en place.

### 7.1 Compte Resend et domaine kfauto.tg

1. Créer un compte sur https://resend.com (offre gratuite : 3 000 e-mails/mois, 100/jour).
2. **Domains > Add Domain** : saisir `kfauto.tg` (région conseillée : Ireland, eu-west-1).
3. Resend affiche les enregistrements DNS à ajouter chez l'hébergeur du domaine kfauto.tg. **Les valeurs exactes sont celles affichées par Resend** ; à titre indicatif :

| Type | Nom (hôte) | Valeur | Rôle |
|---|---|---|---|
| MX | `send` (soit send.kfauto.tg) | `feedback-smtp.eu-west-1.amazonses.com`, priorité 10 | retours de l'envoi |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | SPF |
| TXT | `resend._domainkey` | clé publique longue `p=MIGfMA0...` fournie par Resend | DKIM |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | DMARC (recommandé) |

   Ces enregistrements portent sur le sous-domaine `send` et sur `resend._domainkey` : ils ne touchent pas aux MX ni au SPF de la messagerie actuelle des adresses @kfauto.tg. Si un enregistrement `_dmarc` existe déjà, le garder.
4. Cliquer sur **Verify DNS Records** et attendre le statut « Verified » (de quelques minutes à 48 h selon l'hébergeur DNS).
5. **API Keys > Create API Key** : permission « Sending access », domaine `kfauto.tg`. Copier la clé (`re_...`), elle n'est affichée qu'une fois.

### 7.2 Variables d'environnement Vercel

Vercel > projet kf-auto-erp > Settings > Environment Variables (environnement Production), puis **redéployer** :

| Variable | Valeur |
|---|---|
| `RESEND_API_KEY` | la clé `re_...` créée ci-dessus (serveur uniquement, jamais de préfixe `NEXT_PUBLIC_`) |
| `EMAIL_FROM` | `KF Auto ERP <notifications@kfauto.tg>` |
| `CRON_SECRET` | le secret généré dans Supabase Vault (voir 7.3) |
| `NEXT_PUBLIC_APP_URL` | `https://kf-auto-erp.vercel.app` (ou le domaine définitif de l'application) |
| `SUPABASE_SERVICE_ROLE_KEY` | déjà présente (création des comptes) : indispensable pour lire la file d'envoi |

### 7.3 Planification (déjà en place dans Supabase, migration 0049)

- `pg_cron`, toutes les 10 minutes : rappels 24 h / 48 h des actions non traitées (direction en copie à 48 h), rappels d'échéances, puis appel de `https://kf-auto-erp.vercel.app/api/cron/notifications` s'il reste des e-mails à envoyer.
- `pg_cron`, chaque jour à 7 h 00 (heure de Lomé) : récapitulatif des actions en attente pour chaque personne concernée, puis envoi.
- Le secret de l'appel est rangé dans Supabase Vault sous le nom `cron_secret`. Pour le relire : SQL Editor, `select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret';` et copier la valeur dans `CRON_SECRET` sur Vercel. Tant que `CRON_SECRET` n'est pas dans Vercel, la route répond 401 : c'est normal.
- `vercel.json` déclare en plus un cron Vercel quotidien de secours (7 h 15) vers la même route ; le plan Hobby n'autorise qu'un passage par jour, d'où le cron Supabase pour la fréquence de 10 minutes. Vercel envoie lui-même l'en-tête `Authorization: Bearer <CRON_SECRET>`.
- Pour changer l'adresse de l'application dans les jobs : modifier la fonction `public.call_notifications_endpoint()`.

### 7.4 Vérifier

1. Se connecter en super admin, menu **Compte > Notifications**, bouton « M'envoyer un e-mail de test ». Le message d'erreur éventuel de Resend s'affiche (domaine non vérifié, clé invalide...).
2. File d'envoi (SQL Editor) : `select status, count(*) from email_outbox group by status;` puis, en cas d'échec, `select to_email, attempts, last_error from email_outbox where status <> 'envoye' order by created_at desc limit 20;`. Une nouvelle tentative a lieu après 1, 5, 15, 60 puis 240 minutes ; au-delà de 6 tentatives, le statut passe à `echec`.
3. Chaque e-mail envoyé ou en échec définitif apparaît dans le **Journal d'audit** (« E-mail de notification »).
4. Historique des jobs : `select * from cron.job_run_details order by start_time desc limit 20;` et appels HTTP : `select * from net._http_response order by created desc limit 20;`.

Chaque utilisateur peut couper les e-mails d'information (Compte > Notifications) ; les demandes de validation, les rappels et le récapitulatif restent toujours envoyés. Les e-mails ne permettent aucune validation : le bouton ouvre l'application, connexion obligatoire.
