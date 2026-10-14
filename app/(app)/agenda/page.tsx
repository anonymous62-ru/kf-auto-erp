import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getAgenda, type AgendaItem } from '@/lib/crm/agenda';
import { EVENT_STATUS, eventType } from '@/lib/crm/labels';
import { getCurrentProfile } from '@/lib/permissions';
import { AgendaAdd } from '@/components/crm/agenda-add';
import { EventActions } from '@/components/crm/event-actions';

// Agenda des commerciaux (direction, 09/10/2026) : rendez-vous, relances,
// essais et livraisons de la semaine. Chaque commercial voit le sien ; la
// direction et les chefs de service consultent celui de tous. Les
// rendez-vous et relances saisis sur les leads y apparaissent aussi.

const TZ = 'Africa/Lome';
const DAY = 86_400_000;

function mondayOf(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // lundi = 0
  return new Date(d.getTime() - dow * DAY);
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ semaine?: string; commercial?: string }> }) {
  const { semaine, commercial } = await searchParams;
  const me = await getCurrentProfile();
  const seesAll = ['super_admin', 'administrateur', 'manager', 'chef_service'].includes(me?.role ?? '');
  const canPlanForOthers = seesAll;

  const today = iso(new Date());
  const start = mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(semaine ?? '') ? (semaine as string) : today);
  const end = new Date(start.getTime() + 7 * DAY);
  // Lomé est en UTC toute l'année : les bornes de jour UTC sont les bonnes.
  const { items, error } = await getAgenda(start.toISOString(), end.toISOString(), seesAll ? commercial || null : null);

  const supabase = await createClient();
  const { data: commercials } = canPlanForOthers
    ? await supabase.from('profiles').select('id, full_name').in('role', ['commercial', 'chef_service', 'responsable_showroom', 'vendeur_showroom']).eq('is_active', true).order('full_name')
    : { data: null };

  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY));
  const byDay = new Map<string, AgendaItem[]>();
  for (const it of items) {
    const key = it.starts_at.slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), it]);
  }

  function href(next: { semaine?: string; commercial?: string | null }) {
    const p = new URLSearchParams();
    p.set('semaine', next.semaine ?? iso(start));
    const c = next.commercial === undefined ? commercial : next.commercial;
    if (c) p.set('commercial', c);
    return `/agenda?${p.toString()}`;
  }
  const pill = (active: boolean) => `chip ${active ? 'chip-active' : ''}`;
  const fmtDay = (d: Date) => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const fmtTime = (s: string) => new Date(s).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  const pending = items.filter((i) => i.status === 'prevu').length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Agenda</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Semaine du {start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })} · {pending} à faire
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={href({ semaine: iso(new Date(start.getTime() - 7 * DAY)) })} className="btn-secondary">
            ← Précédente
          </Link>
          <Link href={href({ semaine: today })} className="btn-secondary">
            Cette semaine
          </Link>
          <Link href={href({ semaine: iso(end) })} className="btn-secondary">
            Suivante →
          </Link>
        </div>
      </div>

      <AgendaAdd commercials={commercials ?? null} date={start.getTime() <= Date.now() && Date.now() < end.getTime() ? today : iso(start)} />

      {seesAll && commercials && commercials.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          <Link href={href({ commercial: null })} className={pill(!commercial)}>
            Toute l&apos;équipe
          </Link>
          {me && (
            <Link href={href({ commercial: me.id })} className={pill(commercial === me.id)}>
              Mon agenda
            </Link>
          )}
          {commercials.map((c) => (
            <Link key={c.id} href={href({ commercial: c.id })} className={pill(commercial === c.id)}>
              {c.full_name}
            </Link>
          ))}
        </div>
      )}

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="space-y-3">
        {days.map((d) => {
          const key = iso(d);
          const list = byDay.get(key) ?? [];
          const isToday = key === today;
          return (
            <section key={key} className={`card overflow-hidden ${isToday ? 'ring-2 ring-kf-orange/60' : ''}`}>
              <p className={`px-4 py-2 text-sm font-semibold capitalize ${isToday ? 'bg-orange-50 text-kf-navy' : 'bg-gray-50/70 text-gray-700'}`}>
                {fmtDay(d)}
                {isToday ? " · aujourd'hui" : ''}
              </p>
              {list.length === 0 ? (
                <p className="px-4 py-3 text-xs text-gray-400">Rien de prévu.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {list.map((it) => {
                    const type = eventType(it.event_type);
                    const st = EVENT_STATUS[it.status] ?? EVENT_STATUS.prevu;
                    const editable = it.source === 'agenda' && (it.owner_id === me?.id || seesAll);
                    return (
                      <li key={`${it.source}-${it.id}`} className={`border-l-4 px-4 py-2.5 ${type.color}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className={`text-sm font-medium ${it.status === 'annule' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                              <span className="num mr-2 text-gray-500">{fmtTime(it.starts_at)}</span>
                              {it.title}
                            </p>
                            <p className="text-xs text-gray-500">
                              {type.label}
                              {it.contact_name ? ` · ${it.contact_name}` : ''}
                              {it.location ? ` · ${it.location}` : ''}
                              {seesAll && it.owner_name ? ` · ${it.owner_name}` : ''}
                            </p>
                            {it.notes && <p className="mt-0.5 text-xs text-gray-600">{it.notes}</p>}
                            <p className="mt-1 flex flex-wrap gap-3 text-xs">
                              {it.deal_id && (
                                <Link href={`/affaires/${it.deal_id}`} className="text-kf-navy hover:underline">
                                  Voir l&apos;affaire
                                </Link>
                              )}
                              {it.lead_id && it.source !== 'agenda' && (
                                <Link href={`/prospects/${it.lead_id}`} className="text-kf-navy hover:underline">
                                  Ouvrir le lead
                                </Link>
                              )}
                              {editable && <EventActions id={it.id} status={it.status} />}
                            </p>
                          </div>
                          <span className={`${st.badge} shrink-0`}>{st.label}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
