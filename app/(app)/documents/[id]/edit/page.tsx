import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DocumentForm } from '@/components/documents/document-form';
import { getDocumentForEdit } from '@/lib/documents/edit-actions';
import type { DocumentType } from '@/lib/documents/actions';

export default async function EditDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const document = await getDocumentForEdit(id);
  if (!document) notFound();

  if (!document.canEdit) {
    return (
      <div className="space-y-4">
        <section className="card p-4 space-y-3">
          <h1 className="text-lg font-semibold text-kf-navy">
            Modification impossible{document.documentNumber ? ` : ${document.documentNumber}` : ''}
          </h1>
          <p className="text-sm text-gray-700">{document.reason}</p>
          <Link href={`/documents/${document.id}`} className="btn-secondary">
            Retour au document
          </Link>
        </section>
      </div>
    );
  }

  return (
    <DocumentForm
      mode="edit"
      documentId={document.id}
      documentNumber={document.documentNumber}
      documentType={document.documentType as DocumentType}
      initialClient={document.client}
      initialItems={document.items}
      initialNotes={document.notes}
    />
  );
}
