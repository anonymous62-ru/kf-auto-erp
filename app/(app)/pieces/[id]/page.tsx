import { getPart, getPartStockHistory } from '@/lib/pieces/actions';
import { PartEditForm } from '@/components/pieces/part-edit-form';
import { PartStockAdjustment } from '@/components/pieces/part-stock-adjustment';
import { PartAvailabilityToggle, PartAvailabilityBadge } from '@/components/pieces/part-availability-toggle';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { IconChevronRight } from '@/components/icons';
import { can } from '@/lib/permissions';

export default async function PartDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const part = await getPart(id);
  const history = await getPartStockHistory(id);

  // Le contrôle de disponibilité ("crochet" Super Admin, demande DG 04/10)
  // n'est affiché en mode édition qu'au Super Admin ; les autres rôles
  // voient seulement un badge en lecture seule.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user?.id ?? '').maybeSingle();
  const isSuperAdmin = profile?.role === 'super_admin';
  const canEdit = can(profile?.role ?? null, 'partWrite');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <Link href="/pieces" className="hover:text-kf-navy">
          Magasin de pièces
        </Link>
        <IconChevronRight className="w-3 h-3" />
        <span className="text-gray-600">{part.designation}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-medium">Pièce : {part.designation}</h1>
        {!isSuperAdmin && <PartAvailabilityBadge isActive={part.is_active} />}
      </div>

      {isSuperAdmin && <PartAvailabilityToggle partId={part.id} isActive={part.is_active} />}

      {canEdit && (
      <PartStockAdjustment
        partId={part.id}
        designation={part.designation}
        quantityOnHand={Number(part.quantity_on_hand)}
        quantityReserved={Number(part.quantity_reserved)}
        stockMin={Number(part.stock_min)}
      />
      )}

      {canEdit && <PartEditForm part={part} />}

      {history.length > 0 && (
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-kf-navy mb-2">Historique des mouvements</h2>
          <div className="space-y-1.5 text-xs">
            {history.map((h) => (
              <div key={h.id} className="flex justify-between border-b border-gray-100 pb-1.5 last:border-0">
                <span className="text-gray-600">
                  {h.movement_type} {h.reason ? `— ${h.reason}` : ''}
                </span>
                <span className={Number(h.quantity) >= 0 ? 'text-green-600' : 'text-kf-red'}>
                  {Number(h.quantity) >= 0 ? '+' : ''}
                  {h.quantity}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
