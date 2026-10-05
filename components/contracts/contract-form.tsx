'use client';

import { useState, useTransition } from 'react';
import { searchClients, createQuickClient, searchProducts } from '@/lib/documents/actions';
import { createSaleContract } from '@/lib/contracts/actions';
import { formatCFA } from '@/lib/documents/calculations';

type ClientOption = { id: string; first_name?: string | null; last_name?: string | null; company_name?: string | null; phone?: string | null };
type ProductOption = { id: string; designation: string; sku?: string | null; sale_price: number; tax_rate: number };

export function ContractForm({ initialProduct }: { initialProduct?: ProductOption | null }) {
  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<ClientOption[]>([]);
  const [selectedClient, setSelectedClient] = useState<ClientOption | null>(null);
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [quickClient, setQuickClient] = useState({ firstName: '', lastName: '', companyName: '', phone: '' });
  const [isCreatingClient, setIsCreatingClient] = useState(false);

  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<ProductOption[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>(initialProduct ?? null);

  const [salePrice, setSalePrice] = useState(initialProduct?.sale_price ?? 0);
  const [paymentTerms, setPaymentTerms] = useState('Paiement comptant à la livraison.');
  const [notes, setNotes] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleClientSearch(value: string) {
    setClientQuery(value);
    if (value.trim().length < 2) {
      setClientResults([]);
      return;
    }
    setClientResults(await searchClients(value));
  }

  async function handleProductSearch(value: string) {
    setProductQuery(value);
    if (value.trim().length < 2) {
      setProductResults([]);
      return;
    }
    setProductResults(await searchProducts(value));
  }

  async function handleQuickCreateClient() {
    if (isCreatingClient) return;
    setError(null);
    if (!quickClient.phone && !quickClient.companyName && !quickClient.lastName) {
      setError('Renseignez au moins un nom ou un téléphone pour le client.');
      return;
    }
    setIsCreatingClient(true);
    try {
      const client = await createQuickClient(quickClient);
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
    if (!selectedProduct) {
      setError('Sélectionnez le véhicule vendu.');
      return;
    }
    if (salePrice <= 0) {
      setError('Le prix de vente doit être positif.');
      return;
    }

    startTransition(async () => {
      try {
        const result = await createSaleContract({
          clientId: selectedClient.id,
          productId: selectedProduct.id,
          salePrice,
          paymentTerms,
          notes,
        });
        if (result?.error) setError(result.error);
      } catch (e) {
        if (e instanceof Error && e.message === 'NEXT_REDIRECT') return;
        setError(e instanceof Error ? e.message : 'Erreur lors de la création du contrat');
      }
    });
  }

  return (
    <div className="space-y-4 pb-6">
      <h1 className="text-lg font-semibold text-kf-navy">Nouveau contrat de vente</h1>

      <section className="card p-4 space-y-2">
        <p className="field-label uppercase tracking-wide">Client (acheteur)</p>
        {selectedClient ? (
          <div className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2">
            <div className="text-sm">
              <p className="font-medium">{selectedClient.company_name || `${selectedClient.first_name ?? ''} ${selectedClient.last_name ?? ''}`}</p>
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
                <div className="flex gap-2">
                  <button onClick={handleQuickCreateClient} disabled={isCreatingClient} className="btn-primary flex-1 !py-1.5">
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

      <section className="card p-4 space-y-2">
        <p className="field-label uppercase tracking-wide">Véhicule vendu</p>
        {selectedProduct ? (
          <div className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2">
            <div className="text-sm">
              <p className="font-medium">{selectedProduct.designation}</p>
              <p className="text-xs text-gray-500">{formatCFA(selectedProduct.sale_price)}</p>
            </div>
            <button className="btn-link" onClick={() => setSelectedProduct(null)}>
              Changer
            </button>
          </div>
        ) : (
          <>
            <input
              value={productQuery}
              onChange={(e) => handleProductSearch(e.target.value)}
              placeholder="Rechercher un véhicule du catalogue..."
              className="input"
            />
            {productResults.length > 0 && (
              <div className="border border-gray-100 rounded-lg divide-y overflow-hidden">
                {productResults.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedProduct(p);
                      setSalePrice(p.sale_price);
                      setProductResults([]);
                      setProductQuery('');
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex justify-between gap-2"
                  >
                    <span>{p.designation}</span>
                    <span className="text-gray-500 whitespace-nowrap">{formatCFA(p.sale_price)}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section className="card p-4 space-y-2">
        <label className="text-xs text-gray-500 block">
          Prix de vente convenu (FCFA)
          <input
            type="number"
            value={salePrice}
            onChange={(e) => setSalePrice(Number(e.target.value))}
            className="input mt-0.5"
          />
        </label>
        <label className="text-xs text-gray-500 block">
          Modalités de paiement
          <textarea
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value)}
            rows={3}
            className="input mt-0.5"
          />
        </label>
        <label className="text-xs text-gray-500 block">
          Conditions particulières (optionnel)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input mt-0.5" />
        </label>
      </section>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      <button onClick={handleSubmit} disabled={isPending} className="btn-primary w-full">
        {isPending ? 'Création...' : 'Créer le contrat'}
      </button>
    </div>
  );
}
