// Simples fonctions de correspondance texte (PAS des Server Actions) — a
// délibérément SON PROPRE fichier sans "use server", séparé de actions.ts.
// Next.js exige que TOUTE fonction exportée d'un fichier "use server" soit
// async (ce sont, par définition, des Server Actions) ; tableLabel/actionLabel
// sont de simples lookups synchrones utilisés directement dans un composant,
// donc les laisser dans actions.ts cassait le build ("Server Actions must be
// async functions").
const TABLE_LABELS: Record<string, string> = {
  documents: 'Document',
  clients: 'Client',
  payments: 'Paiement',
};

const ACTION_LABELS: Record<string, string> = {
  insert: 'Création',
  update: 'Modification',
  delete: 'Suppression',
  login: 'Connexion',
};

export function tableLabel(table: string) {
  return TABLE_LABELS[table] ?? table;
}

export function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action;
}
