// Cachets de l'entreprise (0055), insérés automatiquement sur les documents :
// - service commercial : case du commercial (proforma, bon de commande) ;
// - responsable commercial (facultatif) : case N+1 quand le valideur est
//   responsable commercial (à défaut, cachet du service commercial) ;
// - direction : case N+1 quand le valideur est de la direction, l'ADV ou la
//   comptabilité, et case de la société sur la facture.
import { createClient } from '@/lib/supabase/server';
import { signatureSignedUrl } from '@/lib/signatures/storage';
import { SignatureImageEditor } from '@/components/settings/signature-image-editor';

export async function OrganizationStamps({ organizationId }: { organizationId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('organizations')
    .select('stamp_commercial_path, stamp_sales_manager_path, stamp_direction_path')
    .eq('id', organizationId)
    .maybeSingle();

  const [commercial, salesManager, direction] = await Promise.all([
    signatureSignedUrl(data?.stamp_commercial_path),
    signatureSignedUrl(data?.stamp_sales_manager_path),
    signatureSignedUrl(data?.stamp_direction_path),
  ]);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="section-title">Cachets</h2>
        <p className="text-xs text-gray-500">
          Photo ou scan du cachet sur papier blanc (le blanc est retiré automatiquement). Ils sont ajoutés à côté des
          signatures sur les proformas, bons de commande et factures.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <SignatureImageEditor
          target={{ type: 'stamp', kind: 'commercial' }}
          title="Cachet service commercial"
          description="Case du commercial (proforma, bon de commande)."
          currentUrl={commercial}
        />
        <SignatureImageEditor
          target={{ type: 'stamp', kind: 'sales_manager' }}
          title="Cachet responsable commercial"
          description="Facultatif. Case N+1 quand le responsable commercial valide (sinon cachet service commercial)."
          currentUrl={salesManager}
        />
        <SignatureImageEditor
          target={{ type: 'stamp', kind: 'direction' }}
          title="Cachet direction"
          description="Case N+1 quand la direction, l'ADV ou la comptabilité valide, et facture."
          currentUrl={direction}
        />
      </div>
    </div>
  );
}
