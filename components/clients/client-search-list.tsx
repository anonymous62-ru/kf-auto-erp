'use client';

import { useState } from 'react';
import Link from 'next/link';
import { searchClientsFull } from '@/lib/clients/actions';
import { clientStatus } from '@/lib/documents/labels';

type ClientRow = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  phone?: string | null;
  city?: string | null;
  status?: string | null;
  client_number?: string | null;
};

export function ClientSearchList({
  initialClients,
  status,
  assignedTo,
}: {
  initialClients: ClientRow[];
  status?: 'prospect' | 'client';
  assignedTo?: string;
}) {
  const [query, setQuery] = useState('');
  const [clients, setClients] = useState(initialClients);
  const [loading, setLoading] = useState(false);

  async function handleSearch(value: string) {
    setQuery(value);
    setLoading(true);
    try {
      setClients(await searchClientsFull(value, status, assignedTo));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <input
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder="Rechercher (nom, société, téléphone)..."
        className="w-full border rounded-md px-3 py-2 text-sm"
      />
      {loading && <p className="text-xs text-gray-400">Recherche...</p>}
      {!loading && clients.length === 0 && <p className="text-sm text-gray-400 text-center py-6">Aucun résultat.</p>}
      {clients.map((c) => {
        const st = clientStatus(c.status);
        return (
          <Link
            key={c.id}
            href={`/clients/${c.id}`}
            className="flex items-start justify-between gap-3 bg-white rounded-lg border p-3 text-sm hover:bg-gray-50"
          >
            <span className="min-w-0">
              <span className="block font-medium truncate">{c.company_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`}</span>
              <span className="block text-gray-500 text-xs">
                {c.phone} {c.city ? `- ${c.city}` : ''}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className={st.badge}>{st.label}</span>
              {c.client_number && <span className="block text-xs text-gray-500 mt-1">{c.client_number}</span>}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
