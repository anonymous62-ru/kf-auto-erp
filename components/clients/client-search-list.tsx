'use client';

import { useState } from 'react';
import Link from 'next/link';
import { searchClientsFull } from '@/lib/clients/actions';

type ClientRow = { id: string; first_name?: string; last_name?: string; company_name?: string; phone?: string; city?: string };

export function ClientSearchList({ initialClients }: { initialClients: ClientRow[] }) {
  const [query, setQuery] = useState('');
  const [clients, setClients] = useState(initialClients);
  const [loading, setLoading] = useState(false);

  async function handleSearch(value: string) {
    setQuery(value);
    setLoading(true);
    try {
      setClients(await searchClientsFull(value));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <input
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder="Rechercher un client (nom, société, téléphone)..."
        className="w-full border rounded-md px-3 py-2 text-sm"
      />
      {loading && <p className="text-xs text-gray-400">Recherche...</p>}
      {!loading && clients.length === 0 && <p className="text-sm text-gray-400 text-center py-6">Aucun client trouvé.</p>}
      {clients.map((c) => (
        <Link key={c.id} href={`/clients/${c.id}`} className="block bg-white rounded-lg border p-3 text-sm hover:bg-gray-50">
          <p className="font-medium">{c.company_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`}</p>
          <p className="text-gray-500 text-xs">
            {c.phone} {c.city ? `- ${c.city}` : ''}
          </p>
        </Link>
      ))}
    </div>
  );
}
