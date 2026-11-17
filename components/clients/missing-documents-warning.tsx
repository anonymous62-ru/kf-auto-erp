// Avertissement « pièce manquante » d'un client, réutilisable partout
// (fiche client, vérification de conformité ADV du bon de commande...).
// Composant serveur : lit le client et ses pièces avec la session de
// l'utilisateur (RLS). N'affiche rien si le dossier est complet ; ne bloque
// jamais une vente.
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { missingClientDocuments } from '@/lib/clients/required-documents';
import { IconAlert } from '@/components/icons';

export async function MissingDocumentsWarning({ clientId }: { clientId: string }) {
  if (!clientId) return null;
  const supabase = await createClient();
  const [{ data: client }, { data: docs }] = await Promise.all([
    supabase.from('clients').select('id, client_type, bank_name').eq('id', clientId).maybeSingle(),
    supabase.from('client_documents').select('kind').eq('client_id', clientId),
  ]);
  if (!client) return null;

  const missing = missingClientDocuments(client.client_type, (docs ?? []).map((d) => d.kind as string));
  const noBank = !client.bank_name?.trim();
  if (missing.length === 0 && !noBank) return null;

  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">
      <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        {missing.length > 0 && <p>Pièce manquante : {missing.map((m) => m.label).join(', ')}.</p>}
        {noBank && <p>Banque du client non renseignée.</p>}
        <p className="mt-0.5 text-xs text-amber-700">
          Ne bloque pas la vente.{' '}
          <Link href={`/clients/${client.id}`} className="font-medium underline hover:text-amber-900">
            Compléter la fiche client
          </Link>
        </p>
      </div>
    </div>
  );
}
