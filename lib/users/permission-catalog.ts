// Catalogue des droits réglables par le super admin (migration 0054).
// Fichier partagé, sans 'use server' : importable côté client et serveur.
// Les clés doivent rester alignées sur la fonction SQL default_permission.

export type PermissionKey =
  | 'valider_proforma'
  | 'verifier_commande'
  | 'preparer_facture'
  | 'valider_facture'
  | 'emettre_facture'
  | 'ventes_globales'
  | 'modifier_stock'
  | 'gerer_utilisateurs'
  | 'gerer_objectifs'
  | 'confirmer_paiement';

export const PERMISSIONS: { key: PermissionKey; label: string; help: string }[] = [
  {
    key: 'valider_proforma',
    label: 'Valider les proformas',
    help: "Valide ou refuse une proforma soumise par un commercial avant son envoi au client.",
  },
  {
    key: 'verifier_commande',
    label: 'Vérifier les bons de commande',
    help: 'Déclare un bon de commande conforme ou non conforme.',
  },
  {
    key: 'preparer_facture',
    label: 'Préparer les factures',
    help: "Prépare la facture d'un bon de commande conforme (choix des châssis).",
  },
  {
    key: 'valider_facture',
    label: 'Valider les factures',
    help: "Valide ou refuse une facture préparée, avant son émission.",
  },
  {
    key: 'emettre_facture',
    label: 'Émettre les factures',
    help: 'Émet la facture validée (numéro officiel, plus modifiable ensuite).',
  },
  {
    key: 'ventes_globales',
    label: "Voir les ventes de toute l'équipe",
    help: "Tableau de bord avec les chiffres de tous les commerciaux, et pas seulement les siens.",
  },
  {
    key: 'modifier_stock',
    label: 'Modifier le stock véhicules',
    help: 'Ajoute, modifie ou change le statut des véhicules en stock.',
  },
  {
    key: 'gerer_utilisateurs',
    label: 'Gérer les utilisateurs',
    help: 'Crée, modifie, désactive ou supprime des comptes (jamais un super admin).',
  },
  {
    key: 'gerer_objectifs',
    label: 'Fixer les objectifs',
    help: 'Fixe et modifie les objectifs commerciaux en véhicules.',
  },
  {
    key: 'confirmer_paiement',
    label: 'Confirmer les paiements',
    help: "Confirme la réception d'un paiement enregistré.",
  },
];

export function permissionLabel(key: string) {
  return PERMISSIONS.find((p) => p.key === key)?.label ?? key;
}
