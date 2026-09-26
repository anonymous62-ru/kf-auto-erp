'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { SignaturePad } from '@/components/documents/signature-pad';

export default function SignPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState<'commercial' | 'client' | 'done'>('commercial');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('documents')
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
        <p className="text-sm text-green-700">Document signé par les deux parties.</p>
        <button
          onClick={() => router.push(`/documents/${params.id}`)}
          className="w-full bg-kf-navy text-white rounded-md py-3 text-sm"
        >
          Voir le document
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium">Signature</h1>
      <p className="text-xs text-gray-500">
        Étape {step === 'commercial' ? '1/2' : '2/2'} :{' '}
        {step === 'commercial' ? 'le commercial signe d\'abord' : 'faites signer le client'}
      </p>
      {step === 'commercial' ? (
        <SignaturePad
          documentId={params.id}
          role="commercial"
          onDone={() => setStep('client')}
        />
      ) : (
        <SignaturePad
          documentId={params.id}
          role="client"
          onDone={() => setStep('done')}
        />
      )}
    </div>
  );
}
