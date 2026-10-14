'use client';

import { useEffect, useState, useTransition } from 'react';
import { createDeal, searchDealContacts } from '@/lib/crm/deals';
import { DEAL_STAGES, TEMPERATURES, type DealStage, type Temperature } from '@/lib/crm/labels';
import { formatCFA } from '@/lib/documents/calculations';

type Contact = { kind: 'lead' | 'client'; id: string; name: string; phone: string | null; status?: string | null };

export function DealForm({
  products,
  commercials,
  initialContact,
}: {
  products: { id: string; designation: string; sale_price: number }[];
  commercials: { id: string; full_name: string }[] | null;
  initialContact: Contact | null;
}) {
  const [contact, setContact] = useState<Contact | null>(initialContact);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Contact[]>([]);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [amount, setAmount] = useState(0);
  const [amountTouched, setAmountTouched] = useState(false);
  const [temp, setTemp] = useState<Temperature>('tiede');
  const [stage, setStage] = useState<DealStage>('decouverte');
  const [closeDate, setCloseDate] = useState('');
  const [notes, setNotes] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const product = products.find((p) => p.id === productId);

  useEffect(() => {
    if (!amountTouched) setAmount(product ? product.sale_price * quantity : 0);
  }, [productId, quantity, amountTouched, product]);

  useEffect(() => {
    if (!titleTouched) {
      setTitle([product?.designation, contact?.name].filter(Boolean).join(' - '));
    }
  }, [product, contact, titleTouched]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => setResults(await searchDealContacts(query)), 250);
    return () => clearTimeout(t);
  }, [query]);

  function submit() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const r = await createDeal({
        title,
        assignedTo: assignedTo || undefined,
        leadId: contact?.kind === 'lead' ? contact.id : null,
        clientId: contact?.kind === 'client' ? contact.id : null,
        productId: productId || null,
        quantity,
        estimatedAmount: amount,
        temperature: temp,
        stage,
        expectedCloseDate: closeDate || null,
        notes,
      });
      if (r?.error) setError(r.error);
    });
  }

  return (
    <div className="card p-4 space-y-4 max-w-2xl">
      <div className="space-y-1">
        <p className="text-xs text-gray-500">Lead ou contact</p>
        {contact ? (
          <div className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2 text-sm">
            <span>
              <span className="font-medium">{contact.name}</span>{' '}
              <span className="text-xs text-gray-500">
                {contact.kind === 'lead' ? 'lead' : contact.status === 'client' ? 'client' : 'prospect'}
                {contact.phone ? ` · ${contact.phone}` : ''}
              </span>
            </span>
            <button type="button" onClick={() => setContact(null)} className="text-xs text-kf-navy underline">
              Changer
            </button>
          </div>
        ) : (
          <>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom, société ou téléphone" className="input" />
            {results.length > 0 && (
              <ul className="max-h-56 overflow-y-auto divide-y divide-gray-100 rounded-md border border-gray-200">
                {results.map((c) => (
                  <li key={`${c.kind}-${c.id}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setContact(c);
                        setQuery('');
                        setResults([]);
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                    >
                      <span className="font-medium">{c.name}</span>{' '}
                      <span className="text-xs text-gray-500">
                        {c.kind === 'lead' ? 'lead' : c.status === 'client' ? 'client' : 'prospect'}
                        {c.phone ? ` · ${c.phone}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-xs text-gray-500 sm:col-span-2">
          Véhicule envisagé
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className="input mt-1">
            <option value="">Non précisé</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.designation}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-gray-500">
          Quantité
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
            className="input mt-1"
          />
        </label>
      </div>
      <label className="block text-xs text-gray-500">
        Montant estimé (FCFA)
        <input
          inputMode="numeric"
          value={amount ? String(amount) : ''}
          onChange={(e) => {
            setAmountTouched(true);
            setAmount(Number(e.target.value.replace(/\D/g, '')) || 0);
          }}
          className="input mt-1"
        />
        {amount > 0 && <span className="mt-1 block text-gray-400">{formatCFA(amount)}</span>}
      </label>

      <div className="space-y-1">
        <p className="text-xs text-gray-500">Température</p>
        <div className="flex gap-2">
          {TEMPERATURES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTemp(t.value)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md border py-2 text-sm ${
                temp === t.value ? 'border-kf-navy bg-kf-navy text-white' : 'border-gray-200 text-gray-700'
              }`}
            >
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${t.dot}`} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-gray-500">
          Étape
          <select value={stage} onChange={(e) => setStage(e.target.value as DealStage)} className="input mt-1">
            {DEAL_STAGES.filter((s) => !['gagnee', 'perdue', 'commande'].includes(s.value)).map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-gray-500">
          Conclusion prévue le
          <input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} className="input mt-1" />
        </label>
      </div>

      {commercials && (
        <label className="block text-xs text-gray-500">
          Commercial
          <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="input mt-1">
            <option value="">Moi-même</option>
            {commercials.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block text-xs text-gray-500">
        Titre
        <input
          value={title}
          onChange={(e) => {
            setTitleTouched(true);
            setTitle(e.target.value);
          }}
          className="input mt-1"
        />
      </label>
      <label className="block text-xs text-gray-500">
        Notes (besoin, budget, financement, concurrence...)
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="input mt-1" />
      </label>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button type="button" onClick={submit} disabled={isPending} className="btn-primary w-full justify-center">
        {isPending ? 'Enregistrement...' : 'Créer l’affaire'}
      </button>
    </div>
  );
}
