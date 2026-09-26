'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { DocumentType } from '@/lib/documents/actions';
import { searchClientsSmart, searchProductsSmart, type ClientOption, type ProductOption } from '@/lib/offline/cache';
import { createQuickClientSmart, createDocumentSmart } from '@/lib/offline/create';
import { computeDocumentTotals, formatCFA } from '@/lib/documents/calculations';

type LineItem = {
  key: string;
  productId?: string;
  designation: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  discountPercent: number;
};

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  proforma: 'Proforma',
  devis: 'Devis',
  facture: 'Facture',
  bon_livraison: 'Bon de livraison',
  recu: 'Reçu',
  avoir: 'Avoir',
};

export function DocumentForm({
  documentType,
  initialClient,
}: {
  documentType: DocumentType;
  initialClient?: ClientOption | null;
}) {
  const router = useRouter();
  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<ClientOption[]>([]);
  const [selectedClient, setSelectedClient] = useState<ClientOption | null>(initialClient ?? null);
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [quickClient, setQuickClient] = useState({
    firstName: '',
    lastName: '',
    companyName: '',
    phone: '',
    email: '',
    address: '',
  });

  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<ProductOption[]>([]);
  const [items, setItems] = useState<LineItem[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isCreatingClient, setIsCreatingClient] = useState(false);

  const totals = useMemo(() => computeDocumentTotals(items), [items]);

  async function handleClientSearch(value: string) {
    setClientQuery(value);
    if (value.trim().length < 2) {
      setClientResults([]);
      return;
    }
    const results = await searchClientsSmart(value);
    setClientResults(results);
  }

  async function handleProductSearch(value: string) {
    setProductQuery(value);
    if (value.trim().length < 2) {
      setProductResults([]);
      return;
    }
    const results = await searchProductsSmart(value);
    setProductResults(results);
  }

  function addProductAsItem(product: ProductOption) {
    // La désignation imprimée doit porter le nom du produit ET ses
    // caractéristiques (marque, modèle, description) : le catalogue les a
    // toujours eues, elles n'étaient simplement jamais reprises ici.
    // Important : le nom du produit doit rester SEUL sur sa propre ligne
    // (titre en gras), et la description (souvent déjà un bloc multi-ligne
    // avec ses propres titres de section "CARACTERISTIQUES TECHNIQUES", etc.)
    // doit suivre telle quelle sur les lignes suivantes — les concaténer sur
    // une seule ligne avec " - " casserait la mise en forme des titres.
    const characteristics = [product.brand, product.model].filter(Boolean).join(' ');
    const lines = [product.designation.toUpperCase()];
    if (product.description) {
      lines.push(product.description);
    } else if (characteristics) {
      lines.push(`(${characteristics})`);
    }
    const designation = lines.join('\n');
    setItems((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        productId: product.id,
        designation,
        quantity: 1,
        unitPrice: product.sale_price,
        taxRate: product.tax_rate,
        discountPercent: 0,
      },
    ]);
    setProductQuery('');
    setProductResults([]);
  }

  function addBlankItem() {
    setItems((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        designation: '',
        quantity: 1,
        unitPrice: 0,
        taxRate: 18,
        discountPercent: 0,
      },
    ]);
  }

  function updateItem(key: string, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  async function handleQuickCreateClient() {
    // Garde contre le double-clic : sans ça, un double-tap (fréquent sur
    // mobile) crée deux fois le même client avant que le premier appel n'ait
    // eu le temps de répondre.
    if (isCreatingClient) return;
    setError(null);
    if (!quickClient.phone && !quickClient.companyName && !quickClient.lastName) {
      setError('Renseignez au moins un nom ou un téléphone pour le client.');
      return;
    }
    setIsCreatingClient(true);
    try {
      const client = await createQuickClientSmart(quickClient);
      setSelectedClient(client);
      setShowQuickCreate(false);
      setClientQuery('');
      setClientResults([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la création du client');
    } finally {
      setIsCreatingClient(false);
    }
  }

  function handleSubmit() {
    setError(null);
    if (!selectedClient) {
      setError('Sélectionnez ou créez un client.');
      return;
    }
    if (items.length === 0) {
      setError('Ajoutez au moins un article.');
      return;
    }
    if (items.some((it) => !it.designation.trim())) {
      setError('Chaque article doit avoir une désignation.');
      return;
    }

    startTransition(async () => {
      try {
        const clientLabel =
          selectedClient.company_name || `${selectedClient.first_name ?? ''} ${selectedClient.last_name ?? ''}`.trim();
        const result = await createDocumentSmart({
          documentType,
          clientId: selectedClient.id,
          clientLabel,
          items: items.map(({ key, ...rest }) => rest),
        });
        if (result.kind === 'remote') {
          router.push(`/documents/${result.id}`);
        } else {
          router.push(`/documents/local/${encodeURIComponent(result.localId)}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur lors de la création du document');
      }
    });
  }

  return (
    <div className="space-y-4 pb-32">
      <h1 className="text-lg font-semibold text-kf-navy">{DOCUMENT_LABELS[documentType]}</h1>

      {/* ---------- Client ---------- */}
      <section className="card p-4 space-y-2">
        <p className="field-label uppercase tracking-wide">Client</p>
        {selectedClient ? (
          <div className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2">
            <div className="text-sm">
              <p className="font-medium">
                {selectedClient.company_name || `${selectedClient.first_name ?? ''} ${selectedClient.last_name ?? ''}`}
              </p>
              <p className="text-xs text-gray-500">{selectedClient.phone}</p>
            </div>
            <button className="btn-link" onClick={() => setSelectedClient(null)}>
              Changer
            </button>
          </div>
        ) : (
          <>
            <input
              value={clientQuery}
              onChange={(e) => handleClientSearch(e.target.value)}
              placeholder="Rechercher un client (nom, téléphone)..."
              className="input"
            />
            {clientResults.length > 0 && (
              <div className="border border-gray-100 rounded-lg divide-y overflow-hidden">
                {clientResults.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setSelectedClient(c);
                      setClientResults([]);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    <p className="font-medium">{c.company_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`}</p>
                    <p className="text-xs text-gray-500">{c.phone}</p>
                  </button>
                ))}
              </div>
            )}
            {!showQuickCreate ? (
              <button onClick={() => setShowQuickCreate(true)} className="btn-link">
                + Nouveau client
              </button>
            ) : (
              <div className="space-y-2 border border-gray-100 bg-gray-50/60 rounded-lg p-3">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    placeholder="Prénom"
                    value={quickClient.firstName}
                    onChange={(e) => setQuickClient((q) => ({ ...q, firstName: e.target.value }))}
                    className="input"
                  />
                  <input
                    placeholder="Nom"
                    value={quickClient.lastName}
                    onChange={(e) => setQuickClient((q) => ({ ...q, lastName: e.target.value }))}
                    className="input"
                  />
                </div>
                <input
                  placeholder="Société (optionnel)"
                  value={quickClient.companyName}
                  onChange={(e) => setQuickClient((q) => ({ ...q, companyName: e.target.value }))}
                  className="input"
                />
                <input
                  placeholder="Téléphone"
                  value={quickClient.phone}
                  onChange={(e) => setQuickClient((q) => ({ ...q, phone: e.target.value }))}
                  className="input"
                />
                <input
                  type="email"
                  placeholder="E-mail (optionnel)"
                  value={quickClient.email}
                  onChange={(e) => setQuickClient((q) => ({ ...q, email: e.target.value }))}
                  className="input"
                />
                <input
                  placeholder="Adresse (optionnel)"
                  value={quickClient.address}
                  onChange={(e) => setQuickClient((q) => ({ ...q, address: e.target.value }))}
                  className="input"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleQuickCreateClient}
                    disabled={isCreatingClient}
                    className="btn-primary flex-1 !py-1.5"
                  >
                    {isCreatingClient ? 'Création...' : 'Créer ce client'}
                  </button>
                  <button onClick={() => setShowQuickCreate(false)} className="btn-secondary flex-1 !py-1.5">
                    Annuler
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* ---------- Articles ---------- */}
      <section className="card p-4 space-y-2">
        <p className="field-label uppercase tracking-wide">Articles</p>

        <input
          value={productQuery}
          onChange={(e) => handleProductSearch(e.target.value)}
          placeholder="Rechercher un produit du catalogue..."
          className="input"
        />
        {productResults.length > 0 && (
          <div className="border border-gray-100 rounded-lg divide-y overflow-hidden">
            {productResults.map((p) => (
              <button
                key={p.id}
                onClick={() => addProductAsItem(p)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex justify-between gap-2"
              >
                <span>
                  <span className="block">{p.designation}</span>
                  {(p.brand || p.model || p.description) && (
                    <span className="block text-xs text-gray-500">
                      {[p.brand, p.model].filter(Boolean).join(' ')}
                      {p.description ? ` - ${p.description}` : ''}
                    </span>
                  )}
                </span>
                <span className="text-gray-500 whitespace-nowrap">{formatCFA(p.sale_price)}</span>
              </button>
            ))}
          </div>
        )}
        <button onClick={addBlankItem} className="btn-link">
          + Ligne libre (article hors catalogue)
        </button>

        <div className="space-y-2 mt-2">
          {items.map((item) => (
            <div key={item.key} className="border border-gray-100 rounded-lg p-2.5 space-y-1.5 bg-gray-50/40">
              <div className="flex gap-2">
                <input
                  value={item.designation}
                  onChange={(e) => updateItem(item.key, { designation: e.target.value })}
                  placeholder="Désignation"
                  className="input flex-1 bg-white"
                />
                <button onClick={() => removeItem(item.key)} className="btn-danger-ghost">
                  Suppr.
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs text-gray-500">
                  Qté
                  <input
                    type="number"
                    min={0}
                    value={item.quantity}
                    onChange={(e) => updateItem(item.key, { quantity: Number(e.target.value) })}
                    className="input mt-0.5"
                  />
                </label>
                <label className="text-xs text-gray-500">
                  PU (FCFA)
                  <input
                    type="number"
                    min={0}
                    value={item.unitPrice}
                    onChange={(e) => updateItem(item.key, { unitPrice: Number(e.target.value) })}
                    className="input mt-0.5"
                  />
                </label>
                <label className="text-xs text-gray-500">
                  TVA %
                  <input
                    type="number"
                    min={0}
                    value={item.taxRate}
                    onChange={(e) => updateItem(item.key, { taxRate: Number(e.target.value) })}
                    className="input mt-0.5"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Totaux ---------- */}
      {items.length > 0 && (
        <section className="card p-4 text-sm space-y-1">
          <div className="flex justify-between text-gray-600">
            <span>Sous-total</span>
            <span>{formatCFA(totals.subtotal)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>TVA</span>
            <span>{formatCFA(totals.taxAmount)}</span>
          </div>
          <div className="flex justify-between font-semibold text-kf-navy border-t pt-1 text-base">
            <span>Total TTC</span>
            <span>{formatCFA(totals.totalAmount)}</span>
          </div>
        </section>
      )}

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur border-t border-gray-100 p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
        <button onClick={handleSubmit} disabled={isPending} className="btn-primary w-full max-w-3xl mx-auto">
          {isPending ? 'Enregistrement...' : `Créer ${DOCUMENT_LABELS[documentType].toLowerCase()}`}
        </button>
      </div>
    </div>
  );
}
