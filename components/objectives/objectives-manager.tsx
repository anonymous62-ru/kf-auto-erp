'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ObjectiveProgress, SalesPerson, VehicleModel } from '@/lib/objectives/queries';
import { deleteObjective, saveObjective } from '@/lib/objectives/actions';
import { formatPeriod, lomeToday, monthRange, quarterRange } from '@/lib/objectives/periods';
import { ObjectivesTable } from '@/components/objectives/objectives-table';

type Shortcut = 'mois' | 'mois-prochain' | 'trimestre' | 'libre';

const SHORTCUTS: { key: Shortcut; label: string }[] = [
  { key: 'mois', label: 'Mois en cours' },
  { key: 'mois-prochain', label: 'Mois prochain' },
  { key: 'trimestre', label: 'Trimestre en cours' },
  { key: 'libre', label: 'Dates libres' },
];

function rangeOf(key: Shortcut) {
  const today = lomeToday();
  if (key === 'mois-prochain') return monthRange(today, 1);
  if (key === 'trimestre') return quarterRange(today);
  return monthRange(today);
}

function shortcutOf(from: string, to: string): Shortcut {
  for (const k of ['mois', 'mois-prochain', 'trimestre'] as const) {
    const r = rangeOf(k);
    if (r.from === from && r.to === to) return k;
  }
  return 'libre';
}

const ROLE_LABELS: Record<string, string> = {
  commercial: 'commercial',
  vendeur_showroom: 'vente showroom',
  responsable_showroom: 'responsable showroom',
};

export function ObjectivesManager({
  rows,
  people,
  models,
}: {
  rows: ObjectiveProgress[];
  people: SalesPerson[];
  models: VehicleModel[];
}) {
  const router = useRouter();
  const initial = rangeOf('mois');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [userId, setUserId] = useState('');
  const [shortcut, setShortcut] = useState<Shortcut>('mois');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [productId, setProductId] = useState('');
  const [units, setUnits] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Verrou synchrone contre le double clic (la transition met un instant à démarrer).
  const busy = useRef(false);

  function reset() {
    const r = rangeOf('mois');
    setEditingId(null);
    setUserId('');
    setShortcut('mois');
    setFrom(r.from);
    setTo(r.to);
    setProductId('');
    setUnits('');
    setNotes('');
  }

  function pickShortcut(k: Shortcut) {
    setShortcut(k);
    if (k !== 'libre') {
      const r = rangeOf(k);
      setFrom(r.from);
      setTo(r.to);
    }
  }

  function edit(r: ObjectiveProgress) {
    setEditingId(r.objective_id);
    setUserId(r.user_id);
    setFrom(r.period_start);
    setTo(r.period_end);
    setShortcut(shortcutOf(r.period_start, r.period_end));
    setProductId(r.product_id ?? '');
    setUnits(String(r.target_units));
    setNotes(r.notes ?? '');
    setError(null);
    setMessage(null);
    document.getElementById('objectif-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function run(task: () => Promise<{ error?: string }>, done: string, after?: () => void) {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await task();
        if (res.error) setError(res.error);
        else {
          setMessage(done);
          after?.();
          router.refresh();
        }
      } catch {
        setError("L'enregistrement a échoué. Vérifiez la connexion et réessayez.");
      } finally {
        busy.current = false;
      }
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(units);
    if (!userId) return setError('Choisissez un commercial.');
    if (!from || !to) return setError('Indiquez les dates de la période.');
    if (to < from) return setError('La fin de la période précède son début.');
    if (!Number.isInteger(n) || n < 1) return setError('Indiquez un nombre de véhicules (au moins 1).');
    run(
      () => saveObjective({ id: editingId, userId, periodStart: from, periodEnd: to, productId: productId || null, targetUnits: n, notes }),
      editingId ? 'Objectif modifié.' : 'Objectif enregistré.',
      reset
    );
  }

  function remove(r: ObjectiveProgress) {
    const what = `${r.user_name || 'ce commercial'}, ${r.product_label ?? 'tous modèles'}, ${formatPeriod(r.period_start, r.period_end)}`;
    if (!window.confirm(`Supprimer l'objectif de ${what} ?`)) return;
    run(() => deleteObjective(r.objective_id), 'Objectif supprimé.', () => {
      if (editingId === r.objective_id) reset();
    });
  }

  const activePeople = people.filter((p) => p.is_active || p.id === userId);

  return (
    <div className="space-y-5">
      <form id="objectif-form" onSubmit={submit} className="card space-y-4 p-4" aria-busy={isPending}>
        <div>
          <h2 className="section-title">{editingId ? "Modifier l'objectif" : 'Fixer un objectif'}</h2>
          <p className="mt-0.5 text-[13px] text-encre-3">
            Nombre de véhicules à facturer sur la période. Laissez « Tous modèles » pour un objectif global, ou choisissez un modèle.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="field-label">Commercial</span>
            <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)} required>
              <option value="">Choisir</option>
              {activePeople.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || 'Sans nom'} ({ROLE_LABELS[p.role] ?? p.role})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Modèle</span>
            <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Tous modèles</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Nombre de véhicules</span>
            <input
              className="input num text-right"
              type="number"
              inputMode="numeric"
              min={1}
              max={10000}
              step={1}
              value={units}
              onChange={(e) => setUnits(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="5"
              required
            />
          </label>
          <label className="block">
            <span className="field-label">Note (facultatif)</span>
            <input className="input" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>

        <fieldset>
          <legend className="field-label">Période</legend>
          <div className="flex flex-wrap gap-1.5">
            {SHORTCUTS.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`chip ${shortcut === s.key ? 'chip-active' : ''}`}
                aria-pressed={shortcut === s.key}
                onClick={() => pickShortcut(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="field-label">Du</span>
              <input
                className="input num"
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setShortcut('libre');
                }}
                required
              />
            </label>
            <label className="block">
              <span className="field-label">Au</span>
              <input
                className="input num"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => {
                  setTo(e.target.value);
                  setShortcut('libre');
                }}
                required
              />
            </label>
            {from && to && to >= from && <p className="pb-2 text-[13px] text-encre-3">{formatPeriod(from, to)}</p>}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn-primary" disabled={isPending}>
            {isPending ? 'Enregistrement...' : editingId ? 'Enregistrer les modifications' : "Enregistrer l'objectif"}
          </button>
          {editingId && (
            <button type="button" className="btn-secondary" disabled={isPending} onClick={reset}>
              Annuler
            </button>
          )}
          {message && (
            <span className="text-[13px] text-[#12804F]" role="status">
              {message}
            </span>
          )}
        </div>
        {error && (
          <p className="rounded-md border border-[#F3C2C4] bg-rouge-clair px-3 py-2 text-sm text-rouge" role="alert">
            {error}
          </p>
        )}
      </form>

      <section className="card overflow-hidden" aria-labelledby="liste-objectifs">
        <div className="card-header">
          <h2 id="liste-objectifs" className="card-title">
            Objectifs de la période
          </h2>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 pb-6 pt-2 text-[13px] text-encre-3">Aucun objectif sur cette période.</p>
        ) : (
          <ObjectivesTable
            rows={rows}
            actions={(r) => (
              <span className="inline-flex gap-1">
                <button type="button" className="btn-ghost btn-sm" disabled={isPending} onClick={() => edit(r)}>
                  Modifier
                </button>
                <button type="button" className="btn-danger-ghost" disabled={isPending} onClick={() => remove(r)}>
                  Supprimer
                </button>
              </span>
            )}
          />
        )}
      </section>
    </div>
  );
}
