import Link from 'next/link';
import { listVehicleUnits } from '@/lib/stock/actions';
import {
  AGE_BUCKETS,
  VEHICLE_STATUS,
  VEHICLE_STATUS_ORDER,
  ageLabel,
  ageTone,
  daysInStock,
  vehicleStatus,
  type VehicleStatus,
} from '@/lib/stock/labels';
import { documentTypeLabel } from '@/lib/documents/labels';
import { can, getCurrentRole } from '@/lib/permissions';
import { IconPlus } from '@/components/icons';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { ViewToggle } from '@/components/ui/view-toggle';

// Stock véhicules (direction, 09/10/2026) : chaque véhicule avec son numéro
// de châssis, son statut, sa date d'entrée et son ancienneté. Filtres par
// modèle, statut et ancienneté ; tri du plus ancien au plus récent (ou
// l'inverse) pour repérer les véhicules qui "dorment" en stock.

type Search = { modele?: string; statut?: string; age?: string; tri?: string; q?: string; vue?: string };

export default async function StockPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const role = await getCurrentRole();
  const canWrite = can(role, 'vehicleUnitWrite');
  const { units, error } = await listVehicleUnits();
  const view = params.vue === 'liste' ? 'liste' : 'grille';
  const supabase = await createClient();
  const { data: productPhotos } = await supabase.from('products').select('id, photo_url');
  const photoOf = new Map(((productPhotos ?? []) as { id: string; photo_url: string | null }[]).map((p) => [p.id, p.photo_url]));

  const statut = params.statut && (params.statut === 'tous' || params.statut in VEHICLE_STATUS) ? params.statut : 'en_stock';
  const bucket = AGE_BUCKETS.find((b) => b.value === params.age);
  const tri = params.tri === 'recent' ? 'recent' : 'ancien';
  const q = params.q?.trim().toUpperCase() ?? '';

  const models = Array.from(new Map(units.map((u) => [u.product_id, u.model])).entries()).sort((a, b) =>
    a[1].localeCompare(b[1])
  );

  const withAge = units.map((u) => ({ ...u, days: daysInStock(u.entry_date, u.status === 'vendu' ? u.sold_at : null) }));
  const byModel = params.modele ? withAge.filter((u) => u.product_id === params.modele) : withAge;
  const filtered = byModel
    .filter((u) => (statut === 'tous' ? true : statut === 'en_stock' ? u.status !== 'vendu' : u.status === statut))
    .filter((u) => (bucket ? u.days >= bucket.min && u.days <= bucket.max : true))
    .filter((u) => (q ? u.vin.includes(q) || (u.document_number ?? '').toUpperCase().includes(q) : true))
    .sort((a, b) => (tri === 'ancien' ? b.days - a.days : a.days - b.days));

  const counts = VEHICLE_STATUS_ORDER.reduce(
    (acc, s) => ({ ...acc, [s]: byModel.filter((u) => u.status === s).length }),
    {} as Record<VehicleStatus, number>
  );
  const inStock = byModel.filter((u) => u.status !== 'vendu');
  const freeToSell = inStock.filter((u) => u.status === 'disponible' && !u.document_id).length;
  const sleeping = inStock.filter((u) => u.days > 91).length;

  // Synthèse par modèle (véhicules non vendus).
  const summary = models.map(([id, name]) => {
    const list = withAge.filter((u) => u.product_id === id && u.status !== 'vendu');
    return {
      id,
      name,
      total: list.length,
      free: list.filter((u) => u.status === 'disponible' && !u.document_id).length,
      reserved: list.filter((u) => u.status === 'reserve' || (u.status === 'disponible' && u.document_id)).length,
      other: list.filter((u) => ['demo', 'essai', 'endommage'].includes(u.status)).length,
      oldest: list.reduce((m, u) => Math.max(m, u.days), 0),
    };
  });

  function href(next: Partial<Search>) {
    const p = new URLSearchParams();
    const merged = { ...params, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/stock?${s}` : '/stock';
  }
  const pill = (active: boolean) => `chip ${active ? 'chip-active' : ''}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock véhicules"
        description={
          <>
            {inStock.length} véhicule{inStock.length > 1 ? 's' : ''} en stock, {freeToSell} libre{freeToSell > 1 ? 's' : ''} à la vente
            {sleeping > 0 && <span className="text-kf-red">, {sleeping} depuis plus de 3 mois</span>}
          </>
        }
        actions={
          <>
            <ViewToggle view={view} hrefFor={(v) => href({ vue: v === 'liste' ? 'liste' : undefined })} />
            {canWrite && (
              <Link href="/stock/new" className="btn-primary">
                <IconPlus className="h-4 w-4" /> Entrée en stock
              </Link>
            )}
          </>
        }
      />

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {units.length === 0 && !error ? (
        <div className="card">
          <EmptyState
            title="Aucun véhicule enregistré par numéro de châssis"
            description="Saisissez les véhicules présents au parc : un numéro de châssis par ligne, avec leur date d'entrée."
            action={canWrite ? { href: '/stock/new', label: 'Saisir les véhicules du parc' } : undefined}
          />
        </div>
      ) : (
        <>
          {summary.length > 0 && (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Modèle</th>
                    <th className="num">En stock</th>
                    <th className="num">Libres</th>
                    <th className="num hidden sm:table-cell">Attribués / réservés</th>
                    <th className="num hidden sm:table-cell">Démo, essais, endommagés</th>
                    <th className="num">Plus ancien</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((m) => (
                    <tr key={m.id} className={params.modele === m.id ? 'bg-[#f3f5fa]' : undefined}>
                      <td>
                        <Link href={href({ modele: params.modele === m.id ? undefined : m.id })} className="font-medium hover:text-kf-navy">
                          {m.name}
                        </Link>
                      </td>
                      <td className="num">{m.total}</td>
                      <td className="num font-medium">{m.free}</td>
                      <td className="num hidden sm:table-cell">{m.reserved}</td>
                      <td className="num hidden sm:table-cell">{m.other}</td>
                      <td className={`num text-xs ${ageTone(m.oldest)}`}>{m.total ? ageLabel(m.oldest) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="space-y-2">
            <form action="/stock" className="flex gap-2">
              {Object.entries(params)
                .filter(([k, v]) => k !== 'q' && v)
                .map(([k, v]) => (
                  <input key={k} type="hidden" name={k} value={v} />
                ))}
              <input name="q" defaultValue={params.q ?? ''} placeholder="Numéro de châssis ou de document" className="input h-9 py-1.5 sm:max-w-sm" />
              <button type="submit" className="btn-secondary shrink-0">
                Rechercher
              </button>
            </form>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              <Link href={href({ statut: undefined })} className={pill(statut === 'en_stock')}>
                En stock
              </Link>
              {VEHICLE_STATUS_ORDER.map((s) => (
                <Link key={s} href={href({ statut: s })} className={pill(statut === s)}>
                  {VEHICLE_STATUS[s].short} <span className="num opacity-70">{counts[s]}</span>
                </Link>
              ))}
              <Link href={href({ statut: 'tous' })} className={pill(statut === 'tous')}>
                Tous
              </Link>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              <Link href={href({ age: undefined })} className={pill(!bucket)}>
                Toute ancienneté
              </Link>
              {AGE_BUCKETS.map((b) => (
                <Link key={b.value} href={href({ age: b.value })} className={pill(bucket?.value === b.value)}>
                  {b.label}
                </Link>
              ))}
              <span className="mx-1 border-l border-gray-200" />
              <Link href={href({ tri: undefined })} className={pill(tri === 'ancien')}>
                Plus anciens d&apos;abord
              </Link>
              <Link href={href({ tri: 'recent' })} className={pill(tri === 'recent')}>
                Plus récents d&apos;abord
              </Link>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="card">
              <EmptyState compact title="Aucun véhicule ne correspond à ces critères" action={{ href: '/stock', label: 'Retirer les filtres' }} />
            </div>
          ) : view === 'grille' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((u) => {
                const st = vehicleStatus(u.status);
                const photo = photoOf.get(u.product_id);
                return (
                  <Link key={u.id} href={`/stock/${u.id}`} className="card card-hover block overflow-hidden">
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo} alt={u.model} className="aspect-[16/10] w-full bg-[#F7F8FA] object-contain" loading="lazy" />
                    ) : (
                      <div className="flex aspect-[16/10] w-full items-center justify-center bg-[#F7F8FA] text-xs text-gray-400">Pas de photo</div>
                    )}
                    <div className="space-y-1 border-t border-gray-100 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 text-sm font-semibold leading-5">{u.model}</p>
                        <span className={st.badge}>{st.short}</span>
                      </div>
                      <p className="num font-mono text-xs text-gray-600">{u.vin}</p>
                      <p className="text-xs text-gray-500">
                        {[u.color, u.status !== 'vendu' ? `en stock ${ageLabel(u.days)}` : null].filter(Boolean).join(' · ')}
                      </p>
                      {u.document_number && (
                        <p className="truncate text-xs text-gray-500">
                          {documentTypeLabel(u.document_type ?? '')} {u.document_number}
                          {u.commercial_name ? ` · ${u.commercial_name}` : ''}
                        </p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Modèle</th>
                    <th>Châssis</th>
                    <th className="hidden md:table-cell">Couleur</th>
                    <th className="hidden md:table-cell">Entrée</th>
                    <th className="hidden lg:table-cell">Document</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => {
                    const st = vehicleStatus(u.status);
                    return (
                      <tr key={u.id}>
                        <td>
                          <Link href={`/stock/${u.id}`} className="font-medium hover:text-kf-navy">
                            {u.model}
                          </Link>
                        </td>
                        <td className="font-mono text-xs">{u.vin}</td>
                        <td className="hidden text-gray-600 md:table-cell">{u.color ?? '-'}</td>
                        <td className="hidden whitespace-nowrap md:table-cell">
                          <span className="num">{new Date(`${u.entry_date}T00:00:00`).toLocaleDateString('fr-FR')}</span>
                          {u.status !== 'vendu' && <span className={`block text-xs ${ageTone(u.days)}`}>{ageLabel(u.days)}</span>}
                        </td>
                        <td className="hidden text-xs text-gray-600 lg:table-cell">
                          {u.document_number ? `${documentTypeLabel(u.document_type ?? '')} ${u.document_number}` : '-'}
                          {u.commercial_name ? <span className="block text-gray-500">{u.commercial_name}</span> : null}
                        </td>
                        <td>
                          <span className={st.badge}>{st.short}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
