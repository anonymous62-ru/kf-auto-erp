// Libellés des affaires et de l'agenda (étape 3, direction 09/10/2026).

export type Temperature = 'chaude' | 'tiede' | 'froide';
export type DealStage = 'decouverte' | 'proforma' | 'negociation' | 'commande' | 'gagnee' | 'perdue';
export type EventType = 'rdv' | 'relance' | 'essai' | 'livraison' | 'autre';
export type EventStatus = 'prevu' | 'fait' | 'annule';

export const TEMPERATURES: { value: Temperature; label: string; badge: string; dot: string }[] = [
  { value: 'chaude', label: 'Chaude', badge: 'badge-red', dot: 'bg-red-500' },
  { value: 'tiede', label: 'Tiède', badge: 'badge-orange', dot: 'bg-orange-400' },
  { value: 'froide', label: 'Froide', badge: 'badge-navy', dot: 'bg-sky-500' },
];

export function temperature(value: string) {
  return TEMPERATURES.find((t) => t.value === value) ?? TEMPERATURES[1];
}

export const DEAL_STAGES: { value: DealStage; label: string; badge: string }[] = [
  { value: 'decouverte', label: 'Découverte', badge: 'badge-gray' },
  { value: 'proforma', label: 'Proforma envoyée', badge: 'badge-navy' },
  { value: 'negociation', label: 'Négociation', badge: 'badge-orange' },
  { value: 'commande', label: 'Commande passée', badge: 'badge-orange' },
  { value: 'gagnee', label: 'Gagnée', badge: 'badge-green' },
  { value: 'perdue', label: 'Perdue', badge: 'badge-gray' },
];

export const OPEN_STAGES: DealStage[] = ['decouverte', 'proforma', 'negociation', 'commande'];

export function dealStage(value: string) {
  return DEAL_STAGES.find((s) => s.value === value) ?? DEAL_STAGES[0];
}

export const EVENT_TYPES: { value: EventType; label: string; color: string }[] = [
  { value: 'rdv', label: 'Rendez-vous', color: 'border-l-kf-navy' },
  { value: 'relance', label: 'Relance', color: 'border-l-orange-400' },
  { value: 'essai', label: 'Essai', color: 'border-l-green-500' },
  { value: 'livraison', label: 'Livraison', color: 'border-l-red-500' },
  { value: 'autre', label: 'Autre', color: 'border-l-gray-300' },
];

export function eventType(value: string) {
  return EVENT_TYPES.find((t) => t.value === value) ?? EVENT_TYPES[4];
}

export const EVENT_STATUS: Record<EventStatus, { label: string; badge: string }> = {
  prevu: { label: 'Prévu', badge: 'badge-navy' },
  fait: { label: 'Fait', badge: 'badge-green' },
  annule: { label: 'Annulé', badge: 'badge-gray' },
};

// ---------- Campagnes marketing (étape 4) ----------
export const CHANNELS: { value: string; label: string }[] = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'site_web', label: 'Site web' },
  { value: 'radio', label: 'Radio' },
  { value: 'television', label: 'Télévision' },
  { value: 'affichage', label: 'Affichage' },
  { value: 'presse', label: 'Presse' },
  { value: 'sms', label: 'SMS' },
  { value: 'salon', label: 'Salon / foire' },
  { value: 'evenement', label: 'Événement' },
  { value: 'autre', label: 'Autre' },
];

export function channelLabel(value: string) {
  return CHANNELS.find((c) => c.value === value)?.label ?? value;
}

export const CAMPAIGN_STATUS: { value: string; label: string; badge: string }[] = [
  { value: 'preparation', label: 'En préparation', badge: 'badge-gray' },
  { value: 'en_cours', label: 'En cours', badge: 'badge-green' },
  { value: 'terminee', label: 'Terminée', badge: 'badge-navy' },
  { value: 'annulee', label: 'Annulée', badge: 'badge-gray' },
];

export function campaignStatus(value: string) {
  return CAMPAIGN_STATUS.find((s) => s.value === value) ?? CAMPAIGN_STATUS[0];
}

export const LEAD_SOURCES: Record<string, string> = {
  showroom: 'Showroom',
  appel: 'Appel téléphonique',
  whatsapp: 'WhatsApp',
  site_web: 'Site web',
  reseaux_sociaux: 'Réseaux sociaux',
  recommandation: 'Recommandation',
  autre: 'Autre',
};
