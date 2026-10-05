// Recherche client/produit avec bascule automatique online/offline.
// - En ligne : interroge Supabase et met a jour le cache local au passage.
// - Hors-ligne : filtre directement le cache IndexedDB.
import { createClient } from '@/lib/supabase/client';
import { db, type CachedClient, type CachedProduct } from '@/lib/offline/db';
import { applyClientSearch, matchesAllTerms } from '@/lib/search';

export type ClientOption = {
  id: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  phone?: string;
  email?: string;
  address?: string;
};
export type ProductOption = {
  id: string;
  designation: string;
  sku?: string;
  brand?: string;
  model?: string;
  description?: string;
  sale_price: number;
  tax_rate: number;
};

// Hors-ligne : chaque mot saisi doit apparaître quelque part dans la fiche.
function matches(haystack: (string | undefined)[], query: string) {
  return matchesAllTerms(haystack, query);
}

export async function searchClientsSmart(query: string): Promise<ClientOption[]> {
  if (navigator.onLine) {
    try {
      const supabase = createClient();
      let request = supabase
        .from('clients')
        .select('id, first_name, last_name, company_name, phone, email, address')
        .order('created_at', { ascending: false })
        .limit(15);
      request = applyClientSearch(request, query);
      const { data, error } = await request;
      if (error) throw error;
      const results = data ?? [];
      // met a jour le cache local pour un usage hors-ligne ulterieur
      await db.cachedClients.bulkPut(
        results.map((c): CachedClient => ({
          id: c.id,
          firstName: c.first_name ?? undefined,
          lastName: c.last_name ?? undefined,
          companyName: c.company_name ?? undefined,
          phone: c.phone ?? undefined,
          email: c.email ?? undefined,
          address: c.address ?? undefined,
          updatedAt: new Date().toISOString(),
        }))
      );
      return results;
    } catch {
      // reseau indisponible malgre navigator.onLine (cas frequent) : on bascule sur le cache
    }
  }

  const cached = await db.cachedClients.toArray();
  const filtered = query.trim()
    ? cached.filter((c) => matches([c.firstName, c.lastName, c.companyName, c.phone], query))
    : cached;
  return filtered.slice(0, 15).map((c) => ({
    id: c.id,
    first_name: c.firstName,
    last_name: c.lastName,
    company_name: c.companyName,
    phone: c.phone,
    email: c.email,
    address: c.address,
  }));
}

export async function searchProductsSmart(query: string): Promise<ProductOption[]> {
  if (navigator.onLine) {
    try {
      const supabase = createClient();
      let request = supabase
        .from('products')
        .select('id, designation, sku, brand, model, description, sale_price, tax_rate')
        .eq('is_active', true)
        .order('designation')
        .limit(15);
      if (query.trim()) request = request.ilike('designation', `%${query}%`);
      const { data, error } = await request;
      if (error) throw error;
      const results = data ?? [];
      await db.cachedProducts.bulkPut(
        results.map((p): CachedProduct => ({
          id: p.id,
          designation: p.designation,
          sku: p.sku ?? undefined,
          brand: p.brand ?? undefined,
          model: p.model ?? undefined,
          description: p.description ?? undefined,
          salePrice: Number(p.sale_price),
          taxRate: Number(p.tax_rate),
          updatedAt: new Date().toISOString(),
        }))
      );
      return results;
    } catch {
      // idem : bascule silencieuse sur le cache
    }
  }

  const cached = await db.cachedProducts.toArray();
  const filtered = query.trim() ? cached.filter((p) => matches([p.designation, p.sku, p.brand, p.model], query)) : cached;
  return filtered.slice(0, 15).map((p) => ({
    id: p.id,
    designation: p.designation,
    sku: p.sku,
    brand: p.brand,
    model: p.model,
    description: p.description,
    sale_price: p.salePrice,
    tax_rate: p.taxRate,
  }));
}

// Precharge le catalogue produits + les clients recents, pour que la recherche
// hors-ligne ait des resultats meme sans recherche prealable en ligne.
export async function prefetchCatalog() {
  if (!navigator.onLine) return;
  try {
    const supabase = createClient();
    const [{ data: clients }, { data: products }] = await Promise.all([
      supabase
        .from('clients')
        .select('id, first_name, last_name, company_name, phone, email, address')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('products')
        .select('id, designation, sku, brand, model, description, sale_price, tax_rate')
        .eq('is_active', true)
        .limit(300),
    ]);
    const now = new Date().toISOString();
    if (clients?.length) {
      await db.cachedClients.bulkPut(
        clients.map((c): CachedClient => ({
          id: c.id,
          firstName: c.first_name ?? undefined,
          lastName: c.last_name ?? undefined,
          companyName: c.company_name ?? undefined,
          phone: c.phone ?? undefined,
          email: c.email ?? undefined,
          address: c.address ?? undefined,
          updatedAt: now,
        }))
      );
    }
    if (products?.length) {
      await db.cachedProducts.bulkPut(
        products.map((p): CachedProduct => ({
          id: p.id,
          designation: p.designation,
          sku: p.sku ?? undefined,
          brand: p.brand ?? undefined,
          model: p.model ?? undefined,
          description: p.description ?? undefined,
          salePrice: Number(p.sale_price),
          taxRate: Number(p.tax_rate),
          updatedAt: now,
        }))
      );
    }
  } catch {
    // silencieux : le prefetch est un bonus, pas une exigence
  }
}
