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
- [ ] Télécharger le **Word (.docx)** : s'ouvre correctement dans Word/LibreOffice, contenu identique au PDF
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
