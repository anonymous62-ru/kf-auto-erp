'use client';

export function PrintButton({ label = 'Imprimer' }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn-secondary">
      {label}
    </button>
  );
}
