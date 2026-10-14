// Droits du catalogue (direction, 10/10/2026). La base applique les mêmes
// règles (migration 0038, fonctions is_catalogue_editor / is_catalogue_sender).

// Modifient photos et textes des fiches : administration et chargée marketing.
export const CATALOGUE_EDITOR_ROLES = ['super_admin', 'administrateur', 'manager', 'marketing'];

// Génèrent et envoient des catalogues : commerciaux, showroom, marketing,
// administration des ventes et direction.
export const CATALOGUE_SENDER_ROLES = [
  'super_admin',
  'administrateur',
  'manager',
  'admin_ventes',
  'marketing',
  'commercial',
  'responsable_showroom',
  'vendeur_showroom',
  'chef_service',
];

export const PHOTO_KINDS: Record<string, string> = {
  exterieur: 'Extérieur',
  interieur: 'Intérieur',
  detail: 'Détail',
};

export const CATALOGUE_CHANNELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  lien: 'Lien copié',
};

// Validité du lien public envoyé au client.
export const CATALOGUE_LINK_DAYS = 30;

// Garantie constructeur imprimée sur toutes les fiches.
export const WARRANTY_TEXT = 'Garantie 5 ans / 100 000 km';
