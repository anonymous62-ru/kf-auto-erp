'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addVehicleUnits } from '@/lib/stock/actions';

// Entrée en stock : un modèle, une date d'entrée, et la liste des numéros de
// châssis (un par ligne, copiable depuis un bordereau ou un fichier Excel).
export function VehicleEntryForm({
  products,
  defaultProductId,
}: {
  products: { id: string; designation: string }[];
  defaultProductId?: string;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [productId, setProductId] = useState(defaultProductId ?? products[0]?.id ?? '');
  const [entryDate, setEntryDate] = useState(today);
  const [color, setColor] = useState('');
  const [modelYear, setModelYear] = useState('');
  const [location, setLocation] = useState('');
  const [vinText, setVinText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ inserted: number; duplicates: string[] } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Un véhicule par ligne : châssis;moteur;couleur (point-virgule ou
  // tabulation, comme un copier-coller depuis Excel). Sans point-virgule :
  // châssis, puis numéro moteur, puis couleur, séparés par des espaces.
  const entries = useMemo(() => {
    const seen = new Map<string, { engineNumber: string | null; color: string | null }>();
    for (const raw of vinText.split(/\n+/)) {
      const line = raw.trim();
      if (!line) continue;
      const parts = /[;\t]/.test(line) ? line.split(/[;\t]/).map((x) => x.trim()) : line.split(/\s+/);
      const vin = (parts[0] ?? '').toUpperCase().replace(/\s+/g, '');
      const engine = (parts[1] ?? '').toUpperCase().replace(/\s+/g, '') || null;
      const lineColor = parts.slice(2).join(' ').trim() || null;
      if (vin && !seen.has(vin)) seen.set(vin, { engineNumber: engine, color: lineColor });
    }
    return Array.from(seen, ([vin, v]) => ({ vin, ...v }));
  }, [vinText]);
  const vins = entries.map((e) => e.vin);

  function submit() {
    if (isPending) return;
    setError(null);
    setResult(null);
    startTransition(async () => {
      const r = await addVehicleUnits({
        productId,
        vins,
        engineNumbers: entries.map((e) => e.engineNumber),
        colors: entries.map((e) => e.color),
        entryDate,
        color,
        modelYear: modelYear ? Number(modelYear) : null,
        location,
      });
      if (r.error) {
        setError(r.error);
        return;
      }
      setResult({ inserted: r.inserted, duplicates: r.duplicates });
      setVinText('');
      router.refresh();
    });
  }

  return (
    <div className="card p-4 space-y-3 max-w-2xl">
      <label className="block text-xs text-gray-500">
        Modèle
        <select value={productId} onChange={(e) => setProductId(e.target.value)} className="input mt-1">
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.designation}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-xs text-gray-500">
          Date d&apos;entrée en stock
          <input type="date" value={entryDate} max={today} onChange={(e) => setEntryDate(e.target.value)} className="input mt-1" />
        </label>
        <label className="block text-xs text-gray-500">
          Couleur commune (optionnel)
          <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Blanc" className="input mt-1" />
        </label>
        <label className="block text-xs text-gray-500">
          Année modèle (optionnel)
          <input
            inputMode="numeric"
            value={modelYear}
            onChange={(e) => setModelYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="2026"
            className="input mt-1"
          />
        </label>
      </div>
      <label className="block text-xs text-gray-500">
        Emplacement (optionnel)
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Showroom Sagbado, parc..." className="input mt-1" />
      </label>
      <label className="block text-xs text-gray-500">
        Véhicules à ajouter (un par ligne : châssis;moteur;couleur, le moteur et la couleur sont facultatifs)
        <textarea
          value={vinText}
          onChange={(e) => setVinText(e.target.value)}
          rows={6}
          placeholder={'LVVDB11B0RD000001;SQRF4J16A00001;Blanc\nLVVDB11B0RD000002;SQRF4J16A00002;Gris'}
          className="input mt-1 font-mono"
        />
      </label>
      <p className="text-xs text-gray-500">
        {vins.length} véhicule{vins.length > 1 ? 's' : ''} à enregistrer. La date, l&apos;année et l&apos;emplacement
        s&apos;appliquent à toute la liste ; la couleur aussi quand elle n&apos;est pas indiquée sur la ligne. Tout se corrige
        ensuite véhicule par véhicule (bouton Modifier).
      </p>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {result && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {result.inserted} véhicule{result.inserted > 1 ? 's' : ''} ajouté{result.inserted > 1 ? 's' : ''} au stock.
          {result.duplicates.length > 0 && ` Déjà présents (ignorés) : ${result.duplicates.join(', ')}.`}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={isPending || vins.length === 0} className="btn-primary">
          {isPending ? 'Enregistrement...' : 'Enregistrer l’entrée en stock'}
        </button>
        <button type="button" onClick={() => router.push('/stock')} className="btn-secondary">
          Voir le stock
        </button>
      </div>
    </div>
  );
}
