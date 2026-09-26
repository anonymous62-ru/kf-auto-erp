'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateProduct } from '@/lib/products/actions';
import { IconCheck, IconX } from '@/components/icons';

interface Product {
  id: string;
  designation: string;
  sku: string | null;
  brand: string | null;
  model: string | null;
  description: string | null;
  sale_price: number;
  tax_rate: number;
  stock_min: number;
  is_active: boolean;
}

export function ProductEditForm({ product }: { product: Product }) {
  const [form, setForm] = useState({
    designation: product.designation,
    sku: product.sku ?? '',
    brand: product.brand ?? '',
    model: product.model ?? '',
    description: product.description ?? '',
    salePrice: Number(product.sale_price),
    taxRate: Number(product.tax_rate),
    stockMin: Number(product.stock_min),
    isActive: product.is_active,
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
        await updateProduct({ id: product.id, ...form });
        setSuccess(true);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Échec de la sauvegarde.');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="card p-4 space-y-3">
      <h2 className="text-sm font-semibold text-kf-navy">Informations produit</h2>

      <div>
        <label className="field-label">Désignation</label>
        <input
          className="input mt-1"
          required
          value={form.designation}
          onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">Marque</label>
          <input
            className="input mt-1"
            value={form.brand}
            onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
          />
        </div>
        <div>
          <label className="field-label">Modèle</label>
          <input
            className="input mt-1"
            value={form.model}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
          />
        </div>
      </div>

      <div>
        <label className="field-label">SKU</label>
        <input
          className="input mt-1"
          value={form.sku}
          onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
        />
      </div>

      <div>
        <label className="field-label">Description / caractéristiques</label>
        <textarea
          className="input mt-1 font-mono text-xs"
          rows={8}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
        <p className="text-[11px] text-gray-400 mt-1">
          Une section en MAJUSCULES sur sa propre ligne (ex. "CARACTERISTIQUES TECHNIQUES") s'affiche en gras sur
          les documents ; les lignes commençant par "-" s'affichent en liste normale.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="field-label">Prix de vente (FCFA)</label>
          <input
            type="number"
            className="input mt-1"
            value={form.salePrice}
            onChange={(e) => setForm((f) => ({ ...f, salePrice: Number(e.target.value) }))}
          />
        </div>
        <div>
          <label className="field-label">TVA %</label>
          <input
            type="number"
            className="input mt-1"
            value={form.taxRate}
            onChange={(e) => setForm((f) => ({ ...f, taxRate: Number(e.target.value) }))}
          />
        </div>
        <div>
          <label className="field-label">Stock minimum</label>
          <input
            type="number"
            className="input mt-1"
            value={form.stockMin}
            onChange={(e) => setForm((f) => ({ ...f, stockMin: Number(e.target.value) }))}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
        />
        Produit actif (visible dans la recherche et le catalogue)
      </label>

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
