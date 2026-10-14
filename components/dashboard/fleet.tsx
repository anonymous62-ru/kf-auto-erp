'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CarSilhouette } from '@/components/dashboard/car-silhouette';
import type { FleetVehicle } from '@/lib/dashboard/cockpit';

// « Le parc » : une carte par véhicule en stock, du plus ancien au plus
// récent. Au-delà de 90 jours, la carte est bordée de rouge.

const STATUS: Record<FleetVehicle['status'], { label: string; badge: string }> = {
  disponible: { label: 'Disponible', badge: 'badge-green' },
  reserve: { label: 'Réservé, acompte', badge: 'badge-amber' },
  demo: { label: 'Plaque démo', badge: 'badge-blue' },
  essai: { label: 'Essais', badge: 'badge-violet' },
  endommage: { label: 'Endommagé', badge: 'badge-red' },
};

const FILTERS: { key: string; label: string; match: (v: FleetVehicle) => boolean }[] = [
  { key: 'tous', label: 'Tous', match: () => true },
  { key: 'dispo', label: 'Disponibles', match: (v) => v.status === 'disponible' },
  { key: 'res', label: 'Réservés', match: (v) => v.status === 'reserve' },
  { key: 'demo', label: 'Démo et essais', match: (v) => v.status === 'demo' || v.status === 'essai' },
  { key: 'dmg', label: 'Endommagés', match: (v) => v.status === 'endommage' },
];

export function Fleet({ vehicles }: { vehicles: FleetVehicle[] }) {
  const [filter, setFilter] = useState('tous');
  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const list = vehicles.filter(active.match);
  const scale = Math.max(90, vehicles[0]?.days ?? 0);
  const filters = FILTERS.filter((f) => f.key === 'tous' || vehicles.some(f.match));

  return (
    <section aria-labelledby="parc-t">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <h2 id="parc-t" className="font-display text-[19px] font-bold tracking-[-0.01em]">
            Le parc
          </h2>
          <p className="text-[13px] text-encre-3">
            {vehicles.length} véhicule{vehicles.length > 1 ? 's' : ''}, triés du plus ancien au plus récent
          </p>
        </div>
        {filters.length > 1 && (
          <div className="ml-4 hidden gap-1.5 md:flex" role="group" aria-label="Filtrer le parc">
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`chip ${filter === f.key ? 'chip-active' : ''}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
        <Link href="/stock" className="ml-auto text-[13px] font-medium text-[#2357A6] hover:underline">
          Ouvrir le stock
        </Link>
      </div>

      {vehicles.length === 0 ? (
        <div className="card px-6 py-10 text-center">
          <p className="text-sm font-medium">Aucun véhicule enregistré par numéro de châssis</p>
          <p className="mt-1 text-[13px] text-encre-3">Saisissez les véhicules présents au parc pour les voir ici.</p>
          <Link href="/stock/new" className="btn-primary mt-4">
            Entrée en stock
          </Link>
        </div>
      ) : list.length === 0 ? (
        <p className="card px-6 py-8 text-center text-[13px] text-encre-3">Aucun véhicule avec ce statut.</p>
      ) : (
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 xl:grid-cols-5">
          {list.map((v) => {
            const old = v.days > 90;
            const st = STATUS[v.status];
            return (
              <Link
                key={v.id}
                href={`/stock/${v.id}`}
                className={`relative flex min-w-[230px] snap-start flex-col gap-2 rounded-[10px] border bg-white px-3.5 pb-3 pt-3.5 transition-colors hover:bg-[#FAFBFC] md:min-w-0 ${
                  old ? 'border-[#F3C2C4]' : 'border-trait'
                }`}
              >
                <div className="flex h-[62px] items-end justify-center rounded-md px-1.5 [background:linear-gradient(#F5F6F8,#F5F6F8)_bottom/100%_14px_no-repeat]">
                  <CarSilhouette body={v.bodyType} color={v.colorHex} />
                </div>
                <h3 className="font-display text-base font-bold tracking-[-0.01em]">{v.model}</h3>
                <span className="-mt-1.5 truncate text-xs text-encre-3" title={v.vin}>
                  {v.detail}
                </span>
                <div className="flex items-center justify-between gap-2">
                  <span className={st.badge}>{st.label}</span>
                  <span className={`num text-[12.5px] ${old ? 'font-semibold text-rouge' : 'text-encre-2'}`}>
                    {v.days} jour{v.days > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-sm bg-trait-2" aria-hidden="true">
                  <i className={`block h-full ${old ? 'bg-rouge' : 'bg-encre-3'}`} style={{ width: `${Math.max(4, Math.round((v.days / scale) * 100))}%` }} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
