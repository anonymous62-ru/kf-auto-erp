'use client';

// Section « Pièces justificatives » de la fiche client : statut par pièce
// attendue, envoi PDF/image vers le bucket privé, consultation par URL
// signée courte, suppression selon les droits. Une pièce manquante ne
// bloque jamais la vente.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { deleteClientDocument, discardClientUpload, getClientDocumentUrl, registerClientDocument } from '@/lib/clients/documents';
import {
  CLIENT_DOCUMENT_ACCEPT,
  CLIENT_DOCUMENT_LABELS,
  clientDocumentMime,
  documentKindsFor,
  missingClientDocuments,
  safeFileName,
  validateClientDocumentFile,
  type ClientDocumentKind,
} from '@/lib/clients/required-documents';
import { IconAlert, IconCheck, IconDocument } from '@/components/icons';

export interface ClientDocumentRow {
  id: string;
  kind: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  uploaded_by: string;
  uploader_name: string | null;
}

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');

export function ClientDocumentsSection({
  clientId,
  organizationId,
  clientType,
  documents,
  canWrite,
  canDeleteAny,
  currentUserId,
}: {
  clientId: string;
  organizationId: string;
  clientType: string | null;
  documents: ClientDocumentRow[];
  canWrite: boolean;
  canDeleteAny: boolean;
  currentUserId: string | null;
}) {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const kinds = documentKindsFor(clientType);
  const presentKinds = documents.map((d) => d.kind);
  const missing = missingClientDocuments(clientType, presentKinds);
  const companyHasOne = presentKinds.includes('coe') || presentKinds.includes('carte_unique_creation');

  function statusFor(kind: ClientDocumentKind): 'fourni' | 'manquant' | 'facultatif' {
    if (presentKinds.includes(kind)) return 'fourni';
    if (kind === 'autre') return 'facultatif';
    if (clientType === 'entreprise') return companyHasOne ? 'facultatif' : 'manquant';
    return 'manquant';
  }

  function canDelete(d: ClientDocumentRow) {
    if (canDeleteAny) return true;
    return d.uploaded_by === currentUserId && Date.now() - new Date(d.created_at).getTime() < 24 * 3600 * 1000;
  }

  async function run(key: string, task: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setPending(key);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inattendue');
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  function upload(kind: ClientDocumentKind, file: File) {
    void run(`upload-${kind}`, async () => {
      const invalid = validateClientDocumentFile(file.name, file.type, file.size);
      if (invalid) throw new Error(invalid);
      const mime = clientDocumentMime(file.name, file.type)!;
      const path = `${organizationId}/${clientId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
      const supabase = createClient();
      const { error: upError } = await supabase.storage
        .from('client-documents')
        .upload(path, file, { contentType: mime, upsert: false, cacheControl: '60' });
      if (upError) throw new Error(upError.message.includes('size') ? 'Fichier trop lourd : 10 Mo au maximum.' : upError.message);
      const res = await registerClientDocument({ clientId, kind, storagePath: path, fileName: file.name });
      if (!res.ok) {
        await discardClientUpload(path).catch(() => undefined);
        throw new Error(res.error);
      }
      router.refresh();
    });
  }

  function open(d: ClientDocumentRow, download: boolean) {
    // Fenêtre ouverte tout de suite (sinon bloquée par le navigateur), puis
    // dirigée vers l'URL signée.
    const win = download ? null : window.open('', '_blank');
    void run(`open-${d.id}`, async () => {
      const res = await getClientDocumentUrl(d.id, download);
      if (!res.ok) {
        win?.close();
        throw new Error(res.error);
      }
      if (win) {
        win.opener = null;
        win.location.href = res.url;
      } else window.location.href = res.url;
    });
  }

  function remove(d: ClientDocumentRow) {
    if (!window.confirm(`Supprimer la pièce « ${d.file_name} » ?`)) return;
    void run(`delete-${d.id}`, async () => {
      const res = await deleteClientDocument(d.id);
      if (!res.ok) throw new Error(res.error);
      router.refresh();
    });
  }

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="section-title">Pièces justificatives</p>
        <button
          type="button"
          className="btn-secondary"
          disabled={exporting}
          onClick={() => {
            // Anti double clic : un seul téléchargement à la fois.
            if (exporting) return;
            setExporting(true);
            window.location.href = `/api/clients/${clientId}/export`;
            window.setTimeout(() => setExporting(false), 5000);
          }}
        >
          {exporting ? 'Préparation...' : 'Exporter le dossier'}
        </button>
      </div>

      {missing.length > 0 ? (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Pièce manquante : {missing.map((m) => m.label).join(', ')}. La vente reste possible ; complétez le dossier dès que possible.
          </span>
        </p>
      ) : (
        <p className="mb-3 flex items-center gap-2 text-sm text-green-700">
          <IconCheck className="h-4 w-4" /> Dossier complet.
        </p>
      )}

      <ul className="divide-y divide-gray-100">
        {kinds.map((kind) => {
          const st = statusFor(kind);
          const files = documents.filter((d) => d.kind === kind);
          const uploading = pending === `upload-${kind}`;
          return (
            <li key={kind} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <IconDocument className="h-4 w-4 text-gray-400" />
                  <span className="font-medium">{CLIENT_DOCUMENT_LABELS[kind]}</span>
                  {st === 'fourni' && <span className="badge-green">Fourni</span>}
                  {st === 'manquant' && <span className="badge-amber">Manquant</span>}
                  {st === 'facultatif' && <span className="text-xs text-gray-400">Facultatif</span>}
                </div>
                {canWrite && (
                  <>
                    <input
                      ref={(el) => {
                        inputs.current[kind] = el;
                      }}
                      type="file"
                      accept={CLIENT_DOCUMENT_ACCEPT}
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) upload(kind, file);
                      }}
                    />
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={pending !== null}
                      onClick={() => inputs.current[kind]?.click()}
                    >
                      {uploading ? 'Envoi...' : files.length ? 'Ajouter une autre' : 'Ajouter'}
                    </button>
                  </>
                )}
              </div>
              {files.length > 0 && (
                <ul className="mt-2 space-y-1.5 pl-6">
                  {files.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate">{d.file_name}</span>
                        <span className="block text-xs text-gray-500">
                          {fmtSize(d.size_bytes)} - ajouté le {fmtDate(d.created_at)}
                          {d.uploader_name ? ` par ${d.uploader_name}` : ''}
                        </span>
                      </span>
                      <span className="flex shrink-0 gap-3 text-xs">
                        <button type="button" className="text-kf-navy hover:underline disabled:opacity-50" disabled={pending !== null} onClick={() => open(d, false)}>
                          Voir
                        </button>
                        <button type="button" className="text-kf-navy hover:underline disabled:opacity-50" disabled={pending !== null} onClick={() => open(d, true)}>
                          Télécharger
                        </button>
                        {canDelete(d) && (
                          <button type="button" className="text-red-600 hover:underline disabled:opacity-50" disabled={pending !== null} onClick={() => remove(d)}>
                            {pending === `delete-${d.id}` ? 'Suppression...' : 'Supprimer'}
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {error && <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <p className="mt-3 text-xs text-gray-400">PDF, JPEG, PNG, WEBP ou HEIC, 10 Mo au maximum par fichier.</p>
    </div>
  );
}
