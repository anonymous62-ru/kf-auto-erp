# Guide de test complet — KF Auto ERP

Coche au fur et à mesure. Pour chaque ✗, note l'écran, ce que tu as fait, et une capture d'écran si possible —
ça me suffira pour corriger sans aller-retour.

## 0. Avant de commencer

- [ ] Dézippe le dernier zip reçu **par-dessus un dossier vide** (supprime l'ancien dossier au lieu de dézipper
      par-dessus, pour éviter tout fichier obsolète qui traîne)
- [ ] `npm install` (à refaire à chaque fois qu'une nouvelle dépendance a été ajoutée — je te le signale dans mon message)
- [ ] Vérifie que `.env.local` contient bien les 3 clés Supabase
- [ ] `rm -rf .next` puis `npm run dev`
- [ ] Si tu as déjà testé l'app avant le correctif du service worker : dans le navigateur, DevTools → Application →
      Service Workers → Unregister, puis Clear site data, avant de recharger

## 1. Connexion

- [ ] Connexion avec ton compte (email + mot de passe) réussie
- [ ] Le dashboard affiche bien ton nom, le CA du mois, les impayés, le nombre de documents en attente, le nombre de clients
- [ ] Déconnexion puis reconnexion fonctionnent

## 2. Clients

- [ ] Créer un nouveau client (particulier : nom/prénom ; puis un second en entreprise : raison sociale)
- [ ] Recherche en direct dans la liste des clients (taper quelques lettres)
- [ ] Ouvrir la fiche d'un client : historique des documents, total facturé, solde dû corrects
- [ ] Depuis une fiche client, créer un document : le client est bien pré-sélectionné

## 3. Documents (répète pour au moins devis + facture)

- [ ] Créer un devis : ajout de plusieurs lignes (désignation, quantité, prix), calcul du total correct
- [ ] Enregistrer le devis, vérifier qu'il apparaît dans la liste avec un numéro officiel
- [ ] Faire signer (signature tactile client + commercial) sur l'écran prévu à cet effet
- [ ] Télécharger le **PDF** : logo, couleurs, tableau, conditions générales, signatures, pied de page (RCCM/NIF/CNSS) tous corrects
- [ ] Plus aucun export Word : seul le PDF est proposé (une facture ne doit jamais circuler en format modifiable)
- [ ] Proforma : le commercial modifie librement prix et caractéristiques, avant et après envoi
- [ ] Facture sans paiement : l'administration des ventes la modifie (un commercial, non)
- [ ] Après le premier paiement : bouton Modifier absent, toute modification refusée ; « Créer un avoir » visible pour l'administration des ventes et la direction seulement
- [ ] Avoir total : la facture passe Annulée, la commande redevient À facturer, le QR code de la facture affiche « Annulé, sans valeur »
- [ ] Envoyer le document par **WhatsApp** (le lien s'ouvre avec le bon message pré-rempli)
- [ ] Envoyer par **Email** (mailto s'ouvre avec le bon message)
- [ ] Convertir le devis en **facture** : nouveau numéro de facture généré, devis marqué "accepté"
- [ ] Répéter la création pour au moins un bon de livraison, un reçu et un avoir (vérifier que chacun a son propre
      format de numérotation et son bon libellé sur le PDF)

## 4. Mode hors-ligne (le plus important)

- [ ] Couper le Wi-Fi/data du téléphone ou ordinateur
- [ ] Créer un client hors-ligne : il apparaît immédiatement dans la liste, marqué "en attente de synchronisation"
- [ ] Créer un document hors-ligne pour ce client : idem, utilisable tout de suite (signature possible aussi hors-ligne)
- [ ] Réactiver le réseau : la synchronisation se déclenche automatiquement (badge "Synchronisé" en haut), le document
      reçoit son numéro officiel définitif
- [ ] Vérifier qu'aucun doublon de numéro n'apparaît si tu répètes ce test plusieurs fois

## 5. Paiements & impayés

- [ ] Enregistrer un paiement (espèces, virement, Mobile Money…) sur une facture envoyée
- [ ] Le solde dû et le statut de la facture se mettent à jour correctement
- [ ] Le paiement génère une **notification** (cloche en haut) pour le commercial concerné
- [ ] Page **Impayés** : la facture apparaît avec le bon retard en jours et le bon montant
- [ ] Bouton **Relancer** (WhatsApp/Email) sur une facture en retard : message pré-rempli correct
- [ ] (optionnel, prend 24h+ à observer) : une notification automatique de relance apparaît sans action de ta part

## 6. Stock & produits

- [ ] Ajouter un produit/service avec un seuil de stock minimum
- [ ] Faire descendre le stock sous ce seuil (via une vente ou modification manuelle) : notification "stock bas" reçue

## 6 bis. Catalogues

- [ ] Fiche d'un modèle (compte administration ou marketing) : ajouter des photos, en choisir la principale, les réordonner (glisser ou flèches), changer leur type
- [ ] « Importer les photos officielles » : coller l'adresse de la page du modèle sur cheryauto.tg ou kfauto.tg, cocher, importer
- [ ] Remplir accroche, points forts, équipements, couleurs ; « Aperçu de la fiche modèle (PDF) » : 2 pages, bandes et pied de page KF Auto
- [ ] Compte commercial : photos et textes en lecture seule, bouton « Envoyer un catalogue » présent
- [ ] Depuis un lead : envoyer 3 modèles avec prix par WhatsApp ; le lien s'ouvre sur téléphone sans compte, le PDF a couverture, sommaire, une page par modèle, page contacts
- [ ] Ouvrir le lien : le commercial reçoit la notification « Catalogue consulté », l'historique du lead indique « Ouvert »
- [ ] Rapports : bloc « Catalogues envoyés » ; Campagnes : colonne « Catalogues (ouverts) »

## 6 ter. Nouvelle présentation (à vérifier sur ordinateur et sur téléphone)

- [ ] Documents : filtres en haut (numéro, type, statut, commercial, période), tri par colonne, pagination de 25 lignes
- [ ] Fiche document : actions en haut à droite, onglets Infos, Documents, Paiements, Historique, résumé à droite
- [ ] Fiche client : chiffres clés, onglets Infos, Documents, Paiements, Historique
- [ ] Catalogue véhicules et Stock véhicules : bascule Grille / Liste
- [ ] Affaires : glisser une carte de Froide vers Chaude, puis vers Perdue (raison demandée) ; sur téléphone, menu « Déplacer »
- [ ] Badges identiques partout : Brouillon, Envoyé, Commande, Facturé, Payé, En retard, Avoir

## 6 quater. Tableau de bord « cockpit » (migration 0041, déjà appliquée)

- [ ] Organisation (compte direction ou manager) : saisir l'**Objectif mensuel** en FCFA, enregistrer. Un commercial ne voit pas ce réglage.
- [ ] Tableau de bord : le bandeau bleu nuit affiche la date, « Bonjour Prénom » et une phrase calculée (pourcentage de l'objectif, jours ouvrés restants du lundi au vendredi, commandes à facturer).
- [ ] Le compte-tours indique le facturé du mois (factures non annulées, moins les avoirs) sur l'objectif ; sans objectif, il affiche « Objectif non fixé » et un bouton « Fixer l'objectif » pour la direction.
- [ ] Encaissé du mois : la variation compare au même nombre de jours du mois précédent. Reste à encaisser passe en rouge s'il y a des factures en retard.
- [ ] Le parc : une carte par véhicule non vendu, du plus ancien au plus récent ; carte bordée de rouge au-delà de 90 jours ; filtres par statut ; défilement horizontal sur téléphone.
- [ ] Ventes en cours : barre proforma, commande, facture, payé ; l'étape en retard est en rouge.
- [ ] Barre de recherche du haut : un nom de client, un numéro de facture (FAC-2026-...) ou la fin d'un numéro de châssis ouvre la page Recherche.
- [ ] Réglage « réduire les animations » du téléphone ou de l'ordinateur activé : le repère rouge du compte-tours ne bouge plus au chargement.
- [ ] Silhouette pick-up : si un modèle pick-up apparaît en SUV, corriger `products.body_type` à `pickup`.

## 7. Utilisateurs & rôles (compte Super Admin/Administrateur uniquement)

- [ ] Page **Gérer les utilisateurs** accessible
- [ ] Créer un nouveau compte commercial (email + mot de passe temporaire généré)
- [ ] Changer le rôle d'un utilisateur
- [ ] Désactiver puis réactiver un compte
- [ ] Se connecter avec le nouveau compte commercial : il ne voit que ses propres clients/documents

## 8. Sécurité (2FA)

- [ ] Page **Sécurité** : activer la 2FA (scanner le QR code avec Google Authenticator ou équivalent, saisir le code)
- [ ] Se déconnecter puis se reconnecter : le code à 6 chiffres est bien redemandé
- [ ] Désactiver la 2FA : plus jamais redemandé après

## 9. Vérification publique (QR code)

- [ ] Scanner le QR code présent sur un PDF (ou ouvrir `/verify/<id>` directement) sans être connecté : la page
      s'affiche avec type/numéro/date/montant/statut, sans données client ni détail des lignes

## 10. PWA (installation mobile)

- [ ] Sur le téléphone, "Ajouter à l'écran d'accueil" proposé/possible (Chrome/Safari)
- [ ] L'app installée s'ouvre en plein écran, sans barre d'adresse
- [ ] Icône correcte (logo KF Auto) sur l'écran d'accueil

---

**Comment me remonter un problème** : capture d'écran + à quelle étape de cette liste ça correspond. Pour une
erreur technique (page blanche, message en anglais type "Error"), ajoute si possible ce qui s'affiche dans le
terminal où tourne `npm run dev` au même moment — ça me fait gagner du temps.
