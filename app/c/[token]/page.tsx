// Page PUBLIQUE d'un catalogue envoyé à un client (lien WhatsApp ou e-mail).
// Accès par jeton aléatoire, sans compte ; le lien expire après 30 jours.
// N'affiche que des informations catalogue (modèles, photos, prix si le
// commercial les a inclus) et les coordonnées du conseiller.
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { findSendingByToken, recordCatalogueOpen } from '@/lib/catalogue/public';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadCatalogueModels, loadCatalogueOrganization, loadCatalogueSender } from '@/lib/catalogue/data';
import { formatCFA } from '@/lib/documents/calculations';
import { toWhatsappNumber } from '@/lib/utils/phone';
import { WARRANTY_TEXT } from '@/lib/catalogue/roles';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Catalogue KF Auto',
  robots: { index: false, follow: false },
};

function frDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Africa/Lome' });
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F7F8FA] text-[#1F2937]">
      <div className="h-1.5 w-full bg-kf-navy" />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:py-10">{children}</main>
    </div>
  );
}

export default async function PublicCataloguePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let found: Awaited<ReturnType<typeof findSendingByToken>> = { sending: null, expired: false };
  try {
    found = await findSendingByToken(token);
  } catch {
    // configuration serveur absente : traité comme introuvable
  }
  const { sending, expired } = found;

  if (!sending || expired) {
    return (
      <Shell>
        <div className="rounded-md border border-gray-200 bg-white p-6 text-center">
          <p className="text-base font-semibold text-gray-900">{expired ? 'Ce lien a expiré' : 'Catalogue introuvable'}</p>
          <p className="mt-2 text-sm text-gray-600">
            {expired
              ? 'Pour des prix et des disponibilités à jour, demandez un nouveau catalogue à votre conseiller KF Auto.'
              : "Vérifiez l'adresse reçue ou contactez votre conseiller KF Auto."}
          </p>
        </div>
      </Shell>
    );
  }

  const admin = createAdminClient();
  const [models, organization, sender] = await Promise.all([
    loadCatalogueModels(admin, sending.organization_id, sending.product_ids),
    loadCatalogueOrganization(admin, sending.organization_id),
    loadCatalogueSender(admin, sending.created_by),
  ]);
  await recordCatalogueOpen(sending, (await headers()).get('user-agent'));

  const pdfHref = `/api/public/catalogues/${token}/pdf?from=page`;
  const wa = toWhatsappNumber(sender.phone);
  const expiresOn = frDate(sending.expires_at);

  return (
    <Shell>
      <header className="flex items-center justify-between gap-4">
        {organization.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={organization.logo_url} alt={organization.name} className="h-10 w-auto" />
        ) : (
          <p className="text-lg font-semibold text-kf-navy">{organization.name}</p>
        )}
        <p className="text-right text-xs text-gray-500">Lien valable jusqu&apos;au {expiresOn}</p>
      </header>

      <section className="mt-6">
        <p className="text-xs font-semibold text-kf-red">
          {sending.kind === 'fiche' ? 'Fiche modèle' : 'Catalogue'}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900">
          {sending.recipient_name ? `Préparé pour ${sending.recipient_name}` : 'Votre sélection de véhicules'}
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          {models.length} modèle{models.length > 1 ? 's' : ''} sélectionné{models.length > 1 ? 's' : ''} par{' '}
          {sender.full_name || organization.name}.
        </p>
        <a
          href={pdfHref}
          target="_blank"
          rel="noopener"
          className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-kf-navy px-4 py-3 text-sm font-medium text-white hover:bg-kf-navy/90 sm:w-auto"
        >
          Ouvrir le catalogue complet (PDF)
        </a>
      </section>

      <section className="mt-8 space-y-4">
        {models.map((m) => (
          <article key={m.id} className="overflow-hidden rounded-md border border-gray-200 bg-white">
            {m.photos[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.photos[0].url} alt={m.designation} className="aspect-[16/9] w-full bg-[#F7F8FA] object-contain" />
            ) : (
              <div className="flex aspect-[16/9] w-full items-center justify-center bg-[#F7F8FA] text-sm text-gray-400">
                Photo bientôt disponible
              </div>
            )}
            <div className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold text-gray-900">{m.designation}</h2>
                {sending.show_prices && m.salePrice > 0 && (
                  <p className="text-base font-semibold tabular-nums text-kf-navy">{formatCFA(m.salePrice)}</p>
                )}
              </div>
              {m.tagline && <p className="mt-1 text-sm text-gray-600">{m.tagline}</p>}
              {m.highlights.length > 0 && (
                <ul className="mt-3 grid gap-1 text-sm text-gray-700 sm:grid-cols-2">
                  {m.highlights.slice(0, 6).map((h) => (
                    <li key={h} className="flex gap-2">
                      <span className="mt-2 h-1 w-1 shrink-0 bg-kf-navy" />
                      {h}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </article>
        ))}
        {sending.show_prices && sending.prices_valid_until && (
          <p className="text-xs text-gray-500">
            Prix en FCFA, valables jusqu&apos;au {frDate(sending.prices_valid_until)}, dans la limite des stocks disponibles.
          </p>
        )}
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-md bg-kf-navy p-4 text-white">
          <p className="text-xs font-semibold text-orange-300">Garantie</p>
          <p className="mt-1 text-base font-semibold">{WARRANTY_TEXT}</p>
          <p className="mt-1 text-xs text-white/80">Entretien et pièces d&apos;origine dans notre atelier.</p>
        </div>
        <div className="rounded-md border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold text-kf-red">Votre conseiller</p>
          <p className="mt-1 text-base font-semibold text-gray-900">{sender.full_name || organization.name}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {wa && (
              <a
                href={`https://wa.me/${wa}`}
                className="inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
              >
                WhatsApp
              </a>
            )}
            {sender.phone && (
              <a
                href={`tel:${sender.phone.split(/[\/;,]/)[0].replace(/\s/g, '')}`}
                className="inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
              >
                Appeler
              </a>
            )}
            {sender.email && (
              <a
                href={`mailto:${sender.email}`}
                className="inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
              >
                E-mail
              </a>
            )}
          </div>
        </div>
      </section>

      <footer className="mt-10 border-t border-gray-200 pt-4 text-center text-xs text-gray-500">
        <p>
          {[organization.name, [organization.address, organization.city].filter(Boolean).join(', '), organization.phones]
            .filter(Boolean)
            .join('   ')}
        </p>
        <p className="mt-1">
          {[organization.rccm ? `RCCM ${organization.rccm}` : '', organization.nif ? `NIF ${organization.nif}` : '']
            .filter(Boolean)
            .join('   ')}
        </p>
      </footer>
    </Shell>
  );
}
