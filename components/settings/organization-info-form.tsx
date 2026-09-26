'use client';

import { useState } from 'react';
import { updateOrganization, type OrganizationProfile } from '@/lib/organization/actions';
import { IconCheck, IconX } from '@/components/icons';

export function OrganizationInfoForm({ organization }: { organization: OrganizationProfile }) {
  const [form, setForm] = useState({
    name: organization.name ?? '',
    address: organization.address ?? '',
    phones: organization.phones ?? '',
    bankName: organization.bank_name ?? '',
    bankAccount: organization.bank_account ?? '',
    rccm: organization.rccm ?? '',
    nif: organization.nif ?? '',
    cnssNumber: organization.cnss_number ?? '',
    termsAndConditions: organization.terms_and_conditions ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function field(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm((f) => ({ ...f, [key]: e.target.value })),
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      await updateOrganization({ id: organization.id, ...form });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de la sauvegarde.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card p-4 space-y-3">
      <h2 className="text-sm font-semibold text-kf-navy">Informations légales et bancaires</h2>
      <p className="text-xs text-gray-500 -mt-2">Affichées en pied de page des documents.</p>

      <div>
        <label className="field-label">Nom de l'organisation</label>
        <input className="input mt-1" required {...field('name')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">Téléphone(s)</label>
          <input className="input mt-1" {...field('phones')} />
        </div>
        <div>
          <label className="field-label">Adresse</label>
          <input className="input mt-1" {...field('address')} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">Banque</label>
          <input className="input mt-1" {...field('bankName')} />
        </div>
        <div>
          <label className="field-label">Numéro de compte</label>
          <input className="input mt-1" {...field('bankAccount')} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="field-label">RCCM</label>
          <input className="input mt-1" {...field('rccm')} />
        </div>
        <div>
          <label className="field-label">NIF</label>
          <input className="input mt-1" {...field('nif')} />
        </div>
        <div>
          <label className="field-label">N° CNSS</label>
          <input className="input mt-1" {...field('cnssNumber')} />
        </div>
      </div>
      <div>
        <label className="field-label">Conditions générales</label>
        <textarea className="input mt-1" rows={4} {...field('termsAndConditions')} />
        <p className="text-[11px] text-gray-400 mt-1">
          Affichées sur les documents tant qu'ils ne sont pas marqués "payé".
        </p>
      </div>

      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1">
          <IconX className="w-3.5 h-3.5" /> {error}
        </p>
      )}
      {success && (
        <p className="text-xs text-green-600 flex items-center gap-1">
          <IconCheck className="w-3.5 h-3.5" /> Modifications enregistrées.
        </p>
      )}

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Enregistrement...' : 'Enregistrer'}
      </button>
    </form>
  );
}
