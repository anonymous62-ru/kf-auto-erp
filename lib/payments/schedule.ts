// Outils purs (client et serveur) pour l'échéancier des paiements.
// Le contrôle définitif est fait en base (replace_installments) : ici on ne
// fait que pré-remplir et afficher le contrôle en direct.

export type InstallmentInput = { amount: number; dueDate: string };

export type InstallmentStatus = 'a_venir' | 'payee' | 'en_retard';

export const MAX_INSTALLMENTS = 24;

// Montant en francs avec séparateur de milliers (espace normale).
export function formatFCFA(amount: number): string {
  return new Intl.NumberFormat('fr-FR').format(Math.round(amount)).replace(/\s/g, ' ') + ' F CFA';
}

export function formatDateFR(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Ajoute n mois à une date AAAA-MM-JJ en restant sur le dernier jour du mois
// si besoin (31/01 + 1 mois = 28 ou 29/02).
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

// Répartition égale arrondie au franc, la dernière échéance absorbe l'écart ;
// échéances mensuelles à partir d'un mois après la date de départ.
export function buildEqualSchedule(remaining: number, count: number, startDate: string): InstallmentInput[] {
  const total = Math.round(remaining);
  const n = Math.min(Math.max(Math.trunc(count) || 1, 1), MAX_INSTALLMENTS);
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => ({
    amount: i === n - 1 ? total - base * (n - 1) : base,
    dueDate: addMonths(startDate, i + 1),
  }));
}

export function scheduleTotal(rows: InstallmentInput[]): number {
  return rows.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0);
}

// Mêmes règles que la base : montants > 0, dates présentes, >= minDate,
// strictement croissantes, total = reste dû au franc près.
export function validateSchedule(rows: InstallmentInput[], remaining: number, minDate: string): string | null {
  if (rows.length < 1 || rows.length > MAX_INSTALLMENTS) return `Entre 1 et ${MAX_INSTALLMENTS} échéances.`;
  let prev = '';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!Number.isFinite(r.amount) || r.amount <= 0) return `Échéance ${i + 1} : montant supérieur à 0 requis.`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.dueDate)) return `Échéance ${i + 1} : date requise.`;
    if (r.dueDate < minDate) return `Échéance ${i + 1} : date antérieure au ${formatDateFR(minDate)}.`;
    if (prev && r.dueDate <= prev) return 'Les dates doivent être strictement croissantes.';
    prev = r.dueDate;
  }
  if (Math.abs(scheduleTotal(rows) - remaining) >= 1) return 'Le total des échéances doit être égal au reste à échelonner.';
  return null;
}

// Statut affiché : la base passe en « en_retard » toutes les 10 minutes ; on
// anticipe à l'affichage pour ne jamais montrer « à venir » une date passée.
export function displayStatus(status: InstallmentStatus, dueDate: string): InstallmentStatus {
  if (status === 'a_venir' && dueDate < todayISO()) return 'en_retard';
  return status;
}

export const INSTALLMENT_STATUS_LABEL: Record<InstallmentStatus, string> = {
  a_venir: 'À venir',
  payee: 'Payée',
  en_retard: 'En retard',
};

export const INSTALLMENT_STATUS_BADGE: Record<InstallmentStatus, string> = {
  a_venir: 'badge-blue',
  payee: 'badge-green',
  en_retard: 'badge-red',
};
