'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ContractSignaturePad } from '@/components/contracts/contract-signature-pad';

export default function SignContractPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState<'commercial' | 'client' | 'done'>('commercial');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('sale_contracts')
        .select('commercial_signature_url, client_signature_url')
        .eq('id', params.id)
        .single();
      if (data?.client_signature_url) setStep('done');
      else if (data?.commercial_signature_url) setStep('client');
      else setStep('commercial');
      setLoading(false);
    }
    load();
  }, [params.id]);

  if (loading) return <p className="text-sm text-gray-500">Chargement...</p>;

  if (step === 'done') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-green-700">Contrat signé par les deux parties.</p>
        <button onClick={() => router.push(`/contracts/${params.id}`)} className="w-full bg-kf-navy text-white rounded-md py-3 text-sm">
          Voir le contrat
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium">Signature du contrat</h1>
      <p className="text-xs text-gray-500">
        Étape {step === 'commercial' ? '1/2' : '2/2'} : {step === 'commercial' ? 'le vendeur signe d\'abord' : "faites signer l'acheteur"}
      </p>
      {step === 'commercial' ? (
        <ContractSignaturePad contractId={params.id} role="commercial" onDone={() => setStep('client')} />
      ) : (
        <ContractSignaturePad contractId={params.id} role="client" onDone={() => setStep('done')} />
      )}
    </div>
  );
}
