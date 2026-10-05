'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteProduct } from '@/lib/products/actions';

export function DeleteProductButton({ productId, designation }: { productId: string; designation: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleDelete() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteProduct(productId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.archived) {
        alert(`${designation} figure déjà dans des devis, factures ou contrats : il a été retiré du catalogue (archivé) au lieu d'être effacé, pour ne pas modifier ces documents.`);
      }
      router.push('/products');
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="w-full rounded-lg border border-red-200 bg-white py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
      >
        Supprimer ce produit
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
      <p className="text-sm text-red-800">
        Supprimer <strong>{designation}</strong> ? S&apos;il apparaît déjà dans un document, il sera seulement retiré du catalogue.
      </p>
      {error && <p className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          onClick={handleDelete}
          disabled={isPending}
          className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
        >
          {isPending ? 'Suppression...' : 'Oui, supprimer'}
        </button>
        <button
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          disabled={isPending}
          className="flex-1 rounded-lg border border-gray-300 bg-white py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
