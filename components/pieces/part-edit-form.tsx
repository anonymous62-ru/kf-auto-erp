'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updatePart } from '@/lib/pieces/actions';
import { IconCheck, IconX } from '@/components/icons';

interface Part {
  id: string;
  reference: string;
  designation: string;
  brand: string | null;
  compatible_models: string | null;
  supplier_name: string | null;
  location: string | null;
  purchase_price: number;
  sale_price: number;
  tax_rate: number;
  stock_min: number;
}

export function PartEditForm({ part }: { part: Part }) {
  const [form, setForm] = useState({
    reference: part.reference,
    designation: part.designation,
    brand: part.brand ?? '',
    compatibleModels: part.compatible_models ?? '',
    supplierName: part.supplier_name ?? '',
    location: part.location ?? '',
    purchasePrice: Number(part.purchase_price),
    salePrice: Number(part.sale_price),
    taxRate: Number(part.tax_rate),
    stockMin: Number(part.stock_min),
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      try {
        await updatePart({ id: part.id, ...form });
        setSuccess(true);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Échec de la sauvegarde.');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="card p-4 space-y-3">
      <h2 className="text-sm font-semibold text-kf-navy">Fiche pièce</h2>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">Référence</label>
          <input className="input mt-1" required value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
        </div>
        <div>
          <label className="field-label">Marque</label>
          <input className="input mt-1" value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} />
        </div>
      </div>
      <div>
        <label className="field-label">Désignation</label>
        <input className="input mt-1" required value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} />
      </div>
      <div>
        <label className="field-label">Modèles compatibles</label>
        <input className="input mt-1" value={form.compatibleModels} onChange={(e) => setForm((f) => ({ ...f, compatibleModels: e.target.value }))} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">Fournisseur</label>
          <input className="input mt-1" value={form.supplierName} onChange={(e) => setForm((f) => ({ ...f, supplierName: e.target.value }))} />
        </div>
        <div>
          <label className="field-label">Emplacement</label>
          <input className="input mt-1" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">Prix d'achat (FCFA)</label>
          <input type="number" className="input mt-1" value={form.purchasePrice} onChange={(e) => setForm((f) => ({ ...f, purchasePrice: Number(e.target.value) }))} />
        </div>
        <div>
          <label className="field-label">Prix de vente (FCFA)</label>
          <input type="number" className="input mt-1" value={form.salePrice} onChange={(e) => setForm((f) => ({ ...f, salePrice: Number(e.target.value) }))} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">TVA %</label>
          <input type="number" className="input mt-1" value={form.taxRate} onChange={(e) => setForm((f) => ({ ...f, taxRate: Number(e.target.value) }))} />
        </div>
        <div>
          <label className="field-label">Stock minimum</label>
          <input type="number" className="input mt-1" value={form.stockMin} onChange={(e) => setForm((f) => ({ ...f, stockMin: Number(e.target.value) }))} />
        </div>
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
      <button type="submit" className="btn-primary" disabled={isPending}>
        {isPending ? 'Enregistrement...' : 'Enregistrer'}
      </button>
    </form>
  );
}
