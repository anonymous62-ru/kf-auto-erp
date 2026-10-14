'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { updateDeal } from '@/lib/crm/deals';

// Pipeline des affaires en colonnes (style Pipedrive) : Froide, Tiède,
// Chaude, Gagnée, Perdue. Glisser une carte d'une colonne à l'autre change la
// température (ou clôt l'affaire). Sur téléphone, le menu « Déplacer » de
// chaque carte remplace le glisser-déposer.

export type PipelineDeal = {
  id: string;
  title: string;
  contact: string;
  product: string | null;
  owner: string | null;
  amount: number;
  temperature: 'chaude' | 'tiede' | 'froide';
  stage: string;
  stageLabel: string;
  expectedClose: string | null;
};

type ColumnKey = 'froide' | 'tiede' | 'chaude' | 'gagnee' | 'perdue';

const COLUMNS: { key: ColumnKey; label: string; accent: string }[] = [
  { key: 'froide', label: 'Froide', accent: 'bg-sky-400' },
  { key: 'tiede', label: 'Tiède', accent: 'bg-amber-400' },
  { key: 'chaude', label: 'Chaude', accent: 'bg-red-500' },
  { key: 'gagnee', label: 'Gagnée', accent: 'bg-emerald-500' },
  { key: 'perdue', label: 'Perdue', accent: 'bg-gray-400' },
];

function columnOf(d: PipelineDeal): ColumnKey {
  if (d.stage === 'gagnee') return 'gagnee';
  if (d.stage === 'perdue') return 'perdue';
  return d.temperature;
}

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n)).replace(/[  ]/g, ' ');
}

export function DealPipeline({ deals: initial, showOwner }: { deals: PipelineDeal[]; showOwner: boolean }) {
  const [deals, setDeals] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<ColumnKey | null>(null);
  const [lost, setLost] = useState<{ id: string; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  const byColumn = useMemo(() => {
    const map: Record<ColumnKey, PipelineDeal[]> = { froide: [], tiede: [], chaude: [], gagnee: [], perdue: [] };
    for (const d of deals) map[columnOf(d)].push(d);
    return map;
  }, [deals]);

  function move(id: string, target: ColumnKey, lostReason?: string) {
    const deal = deals.find((d) => d.id === id);
    if (!deal || columnOf(deal) === target) return;
    if (target === 'perdue' && !lostReason) {
      setLost({ id, reason: '' });
      return;
    }
    const previous = deals;
    const reopening = deal.stage === 'gagnee' || deal.stage === 'perdue';
    const patch =
      target === 'gagnee'
        ? { stage: 'gagnee' as const }
        : target === 'perdue'
        ? { stage: 'perdue' as const, lostReason }
        : { temperature: target, ...(reopening ? { stage: 'negociation' as const, lostReason: null } : {}) };
    setDeals((all) =>
      all.map((d) =>
        d.id === id
          ? {
              ...d,
              stage: target === 'gagnee' || target === 'perdue' ? target : reopening ? 'negociation' : d.stage,
              stageLabel: target === 'gagnee' ? 'Gagnée' : target === 'perdue' ? 'Perdue' : reopening ? 'Négociation' : d.stageLabel,
              temperature: target === 'gagnee' || target === 'perdue' ? d.temperature : target,
            }
          : d
      )
    );
    setError(null);
    startTransition(async () => {
      const result = await updateDeal(id, patch);
      if (result.error) {
        setDeals(previous);
        setError(result.error);
      }
    });
  }

  return (
    <div>
      {error && <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 lg:mx-0 lg:px-0">
        <div className="grid min-w-[1000px] grid-cols-5 gap-3">
          {COLUMNS.map((col) => {
            const list = byColumn[col.key];
            const total = list.reduce((s, d) => s + d.amount, 0);
            return (
              <section
                key={col.key}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(col.key);
                }}
                onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  if (dragId) move(dragId, col.key);
                  setDragId(null);
                }}
                className={`flex min-h-[420px] flex-col rounded-lg border bg-gray-50 ${over === col.key ? 'border-kf-navy' : 'border-gray-200'}`}
              >
                <header className="border-b border-gray-200 px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <span className={`h-2 w-2 rounded-sm ${col.accent}`} />
                      {col.label}
                    </p>
                    <span className="num text-xs text-gray-500">{list.length}</span>
                  </div>
                  <p className="num mt-0.5 text-xs text-gray-500">{fmt(total)} FCFA</p>
                </header>
                <div className="flex-1 space-y-2 p-2">
                  {list.length === 0 && (
                    <p className="px-2 py-6 text-center text-xs text-gray-400">Glissez une affaire ici</p>
                  )}
                  {list.map((d) => {
                    const late = d.expectedClose && d.expectedClose < today && !['gagnee', 'perdue'].includes(d.stage);
                    return (
                      <article
                        key={d.id}
                        draggable
                        onDragStart={(e) => {
                          setDragId(d.id);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => setDragId(null)}
                        className={`cursor-grab rounded-md border border-gray-200 bg-white p-2.5 active:cursor-grabbing ${
                          dragId === d.id ? 'opacity-40' : ''
                        }`}
                      >
                        <Link href={`/affaires/${d.id}`} className="block text-[13px] font-medium leading-5 hover:text-kf-navy">
                          {d.title}
                        </Link>
                        <p className="mt-0.5 truncate text-xs text-gray-500">{d.contact}</p>
                        {d.product && <p className="truncate text-xs text-gray-500">{d.product}</p>}
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="num whitespace-nowrap text-[13px] font-semibold">{fmt(d.amount)}</span>
                          <span className="badge-gray min-w-0 truncate">{d.stageLabel}</span>
                        </div>
                        {(d.expectedClose || (showOwner && d.owner)) && (
                          <p className={`mt-1 truncate text-[11px] ${late ? 'text-red-700' : 'text-gray-400'}`}>
                            {d.expectedClose
                              ? `${late ? 'Dépassée : ' : 'Prévue le '}${new Date(`${d.expectedClose}T00:00:00`).toLocaleDateString('fr-FR')}`
                              : ''}
                            {showOwner && d.owner ? `${d.expectedClose ? ' · ' : ''}${d.owner}` : ''}
                          </p>
                        )}
                        <label className="mt-2 block lg:hidden">
                          <span className="sr-only">Déplacer</span>
                          <select
                            className="input h-8 py-0 text-xs"
                            value={columnOf(d)}
                            onChange={(e) => move(d.id, e.target.value as ColumnKey)}
                          >
                            {COLUMNS.map((c) => (
                              <option key={c.key} value={c.key}>
                                Déplacer : {c.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {lost && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
          <div className="w-full bg-white p-4 sm:max-w-md sm:rounded-lg sm:border sm:border-gray-200">
            <p className="text-base font-semibold">Affaire perdue</p>
            <p className="mt-1 text-sm text-gray-500">Indiquez la raison : elle alimente les rapports.</p>
            <input
              autoFocus
              className="input mt-3"
              value={lost.reason}
              onChange={(e) => setLost({ ...lost, reason: e.target.value })}
              placeholder="Ex. : prix, financement refusé, plus de nouvelles"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setLost(null)}>
                Annuler
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={lost.reason.trim().length < 2}
                onClick={() => {
                  const { id, reason } = lost;
                  setLost(null);
                  move(id, 'perdue', reason.trim());
                }}
              >
                Marquer perdue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
