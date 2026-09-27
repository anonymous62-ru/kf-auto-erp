import { createClient } from '@/lib/supabase/server';
import { ContractForm } from '@/components/contracts/contract-form';

export default async function NewContractPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string }>;
}) {
  const { productId } = await searchParams;

  let initialProduct = null;
  if (productId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from('products')
      .select('id, designation, sku, sale_price, tax_rate')
      .eq('id', productId)
      .maybeSingle();
    initialProduct = data;
  }

  return <ContractForm initialProduct={initialProduct} />;
}
