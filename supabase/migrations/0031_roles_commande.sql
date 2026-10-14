-- Retours de la direction du 09/10/2026 (étape 1) : nouveaux rôles et
-- nouveau type de document "commande". Fichier séparé : PostgreSQL n'autorise
-- pas l'utilisation d'une valeur d'enum dans la transaction qui l'a créée.

alter type user_role add value if not exists 'admin_ventes';      -- Administratrice des ventes (seule à facturer)
alter type user_role add value if not exists 'marketing';         -- Chargée marketing / communication
alter type user_role add value if not exists 'vendeur_showroom';  -- Chargé de vente showroom
alter type user_role add value if not exists 'chef_service';      -- Chef de service (demande des inscriptions)

alter type document_type add value if not exists 'commande';
