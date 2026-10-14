// Chargement des données d'un catalogue (modèles, photos, textes,
// organisation, commercial). Partagé entre l'aperçu interne (client
// "cookies", RLS) et le lien public (clé serveur, accès par jeton).
import type { SupabaseClient } from '@supabase/supabase-js';

export type CatalogueModel = {
  id: string;
  designation: string;
  brand: string | null;
  model: string | null;
  description: string | null;
  salePrice: number;
  photos: { url: string; kind: string; isMain: boolean }[];
  tagline: string | null;
  highlights: string[];
  equipment: string[];
  colors: string | null;
};

export type CatalogueOrganization = {
  name: string;
  logo_url?: string | null;
  rccm?: string | null;
  nif?: string | null;
  address?: string | null;
  city?: string | null;
  phones?: string | null;
  email?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  cnss_number?: string | null;
};

export type CatalogueSender = { full_name: string; phone: string | null; email: string | null };

export function splitLines(text: string | null | undefined): string[] {
  return (text ?? '')
    .split('\n')
    .map((l) => l.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);
}

export async function loadCatalogueModels(
  supabase: SupabaseClient,
  organizationId: string,
  productIds: string[]
): Promise<CatalogueModel[]> {
  if (productIds.length === 0) return [];
  const [{ data: products }, { data: photos }, { data: texts }] = await Promise.all([
    supabase
      .from('products')
      .select('id, designation, brand, model, description, sale_price')
      .eq('organization_id', organizationId)
      .in('id', productIds),
    supabase
      .from('product_photos')
      .select('product_id, url, kind, is_main, position, created_at')
      .eq('organization_id', organizationId)
      .in('product_id', productIds)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('product_catalogue')
      .select('product_id, tagline, highlights, equipment, colors')
      .eq('organization_id', organizationId)
      .in('product_id', productIds),
  ]);

  type PhotoRow = { product_id: string; url: string; kind: string; is_main: boolean };
  type TextRow = { product_id: string; tagline: string | null; highlights: string | null; equipment: string | null; colors: string | null };
  type ProductRow = { id: string; designation: string; brand: string | null; model: string | null; description: string | null; sale_price: number };

  const byId = new Map(((products ?? []) as ProductRow[]).map((p) => [p.id, p]));
  // L'ordre choisi par le commercial est conservé.
  return productIds
    .filter((id) => byId.has(id))
    .map((id) => {
      const p = byId.get(id)!;
      const t = ((texts ?? []) as TextRow[]).find((x) => x.product_id === id);
      const ph = ((photos ?? []) as PhotoRow[]).filter((x) => x.product_id === id);
      // Photo principale en premier.
      ph.sort((a, b) => Number(b.is_main) - Number(a.is_main));
      return {
        id,
        designation: p.designation,
        brand: p.brand,
        model: p.model,
        description: p.description,
        salePrice: Number(p.sale_price ?? 0),
        photos: ph.map((x) => ({ url: x.url, kind: x.kind, isMain: x.is_main })),
        tagline: t?.tagline?.trim() || null,
        highlights: splitLines(t?.highlights),
        equipment: splitLines(t?.equipment),
        colors: t?.colors?.trim() || null,
      };
    });
}

export async function loadCatalogueOrganization(supabase: SupabaseClient, organizationId: string): Promise<CatalogueOrganization> {
  const { data } = await supabase
    .from('organizations')
    .select('name, logo_url, rccm, nif, address, city, phones, email, bank_name, bank_account, cnss_number')
    .eq('id', organizationId)
    .maybeSingle();
  return (data as CatalogueOrganization | null) ?? { name: 'KF Auto SARL' };
}

export async function loadCatalogueSender(supabase: SupabaseClient, userId: string): Promise<CatalogueSender> {
  const { data } = await supabase.from('profiles').select('full_name, phone, email').eq('id', userId).maybeSingle();
  return {
    full_name: (data?.full_name as string | undefined) ?? '',
    phone: (data?.phone as string | null | undefined) ?? null,
    email: (data?.email as string | null | undefined) ?? null,
  };
}
