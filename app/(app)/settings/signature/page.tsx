import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { signatureSignedUrl } from '@/lib/signatures/storage';
import { SignatureImageEditor } from '@/components/settings/signature-image-editor';

// « Ma signature » (0055) : chaque utilisateur enregistre une fois sa
// signature ; elle est insérée automatiquement sur ses proformas (soumission
// pour le commercial, validation pour le N+1). La direction peut aussi gérer
// la signature des autres utilisateurs.

const ADMIN_ROLES = ['super_admin', 'administrateur'];

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super admin',
  administrateur: 'Administrateur',
  manager: 'Manager',
  responsable_commercial: 'Responsable commercial',
  admin_ventes: 'Administration des ventes',
  comptable: 'Comptable',
  commercial: 'Commercial',
};

export default async function SignatureSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ utilisateur?: string }>;
}) {
  const { utilisateur } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: me } = await supabase
    .from('profiles')
    .select('id, role, full_name, signature_path')
    .eq('id', user.id)
    .maybeSingle();
  if (!me) redirect('/dashboard');

  const isAdmin = ADMIN_ROLES.includes(me.role);
  const mySignatureUrl = await signatureSignedUrl(me.signature_path);

  type Member = { id: string; full_name: string | null; role: string; signature_path: string | null; is_active: boolean | null };
  let team: Member[] = [];
  let selected: Member | null = null;
  let selectedUrl: string | null = null;
  if (isAdmin) {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, role, signature_path, is_active')
      .neq('id', me.id)
      .order('full_name');
    team = ((data ?? []) as Member[]).filter((m) => m.is_active !== false);
    selected = team.find((m) => m.id === utilisateur) ?? null;
    selectedUrl = selected ? await signatureSignedUrl(selected.signature_path) : null;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Ma signature</h1>
        <p className="text-sm text-gray-600">
          Enregistrée une seule fois, votre signature est insérée automatiquement sur les proformas : dans la case du
          commercial quand vous soumettez une proforma à validation, dans la case du responsable (N+1) quand vous en
          validez une. Le cachet de l&apos;entreprise est ajouté à côté.
        </p>
      </div>

      <SignatureImageEditor
        target={{ type: 'signature' }}
        title={`Signature de ${me.full_name ?? 'votre compte'}`}
        description="Dessinez-la ici ou importez une photo de votre signature sur papier blanc."
        currentUrl={mySignatureUrl}
      />

      {isAdmin && (
        <div className="card space-y-3 p-4">
          <div>
            <p className="section-title">Signatures de l&apos;équipe</p>
            <p className="text-xs text-gray-500">
              Réservé à la direction : enregistrez ou retirez la signature d&apos;un utilisateur (par exemple à partir
              d&apos;une signature scannée).
            </p>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Utilisateur</th>
                  <th>Rôle</th>
                  <th>Signature</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {team.map((m) => (
                  <tr key={m.id}>
                    <td className="font-medium">{m.full_name ?? 'Sans nom'}</td>
                    <td className="text-gray-600">{ROLE_LABELS[m.role] ?? m.role}</td>
                    <td>
                      {m.signature_path ? (
                        <span className="badge-green">Enregistrée</span>
                      ) : (
                        <span className="badge-gray">Aucune</span>
                      )}
                    </td>
                    <td className="text-right">
                      <Link href={`/settings/signature?utilisateur=${m.id}`} className="text-kf-navy hover:underline">
                        Gérer
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected && (
            <SignatureImageEditor
              key={selected.id}
              target={{ type: 'signature', userId: selected.id }}
              title={`Signature de ${selected.full_name ?? 'cet utilisateur'}`}
              currentUrl={selectedUrl}
            />
          )}
        </div>
      )}
    </div>
  );
}
