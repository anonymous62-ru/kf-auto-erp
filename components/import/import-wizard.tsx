'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { readSpreadsheet, type Sheet } from '@/lib/import/spreadsheet';
import {
  FIELD_LABELS,
  ISSUE_LABELS,
  STATUS_LABELS,
  autoMapping,
  countContactLikeRows,
  detectHeaderRow,
  displayName,
  fieldsFor,
  phoneKey,
  prepareRows,
  templateCsv,
  type FieldKey,
  type ImportKind,
  type PreparedRow,
} from '@/lib/import/contacts';
import { checkExistingPhones, importContacts } from '@/lib/import/actions';
import { IconAlert, IconCheck, IconDocument, IconChevronRight } from '@/components/icons';

const LABELS: Record<ImportKind, { plural: string; back: string }> = {
  clients: { plural: 'clients', back: '/clients' },
  prospects: { plural: 'prospects', back: '/prospects' },
};

// Lignes envoyées au serveur par paquets, pour rester sous la taille
// maximale d'une requête (et afficher une progression sur les gros fichiers).
const BATCH = 250;

type Step = 'upload' | 'map' | 'preview' | 'done';

export function ImportWizard({ kind }: { kind: ImportKind }) {
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<FieldKey[]>([]);
  const [prepared, setPrepared] = useState<PreparedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sheet = sheets[sheetIndex];
  const headers = sheet?.rows[headerRow] ?? [];
  const label = LABELS[kind];

  function selectSheet(index: number, list = sheets) {
    const s = list[index];
    if (!s) return;
    const h = detectHeaderRow(s.rows, kind);
    setSheetIndex(index);
    setHeaderRow(h);
    setMapping(autoMapping(s.rows[h] ?? [], kind));
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error('Fichier trop volumineux (15 Mo maximum).');
      const list = (await readSpreadsheet(file)).filter((s) => s.rows.some((r) => r.some((c) => c)));
      if (list.length === 0) throw new Error('Le fichier est vide.');
      // Onglet proposé d'office : celui dont le nom parle de prospects (ou de
      // clients), sinon celui qui contient le plus de contacts.
      const hint = kind === 'prospects' ? /prospect|suivi|pipeline/i : /client/i;
      const best = list
        .map((s, i) => ({ i, n: countContactLikeRows(s.rows), named: hint.test(s.name) }))
        .filter((s) => s.n > 0 || list.length === 1)
        .sort((a, b) => Number(b.named) - Number(a.named) || b.n - a.n)[0]?.i ?? 0;
      setFileName(file.name);
      setSheets(list);
      selectSheet(best, list);
      setStep('map');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lecture du fichier impossible.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function goToPreview() {
    setError(null);
    setBusy(true);
    try {
      const rows = prepareRows(sheet.rows, headerRow, mapping, kind);
      const phones = rows.filter((r) => !r.issue && r.record.phone).map((r) => r.record.phone);
      const existing = phones.length ? await checkExistingPhones(phones) : {};
      for (const r of rows) {
        if (r.issue || !r.record.phone) continue;
        const status = existing[phoneKey(r.record.phone)];
        if (status) r.issue = status === 'mine' ? 'exists_mine' : 'exists_other';
      }
      setPrepared(rows);
      setStep('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vérification impossible.');
    } finally {
      setBusy(false);
    }
  }

  const toImport = useMemo(() => prepared.filter((r) => !r.issue), [prepared]);
  const issueCounts = useMemo(() => {
    const counts: Partial<Record<string, number>> = {};
    for (const r of prepared) if (r.issue) counts[r.issue] = (counts[r.issue] ?? 0) + 1;
    return counts;
  }, [prepared]);

  async function runImport() {
    if (busy || toImport.length === 0) return; // garde anti double-clic
    setError(null);
    setBusy(true);
    setProgress(0);
    let inserted = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < toImport.length; i += BATCH) {
        const res = await importContacts(
          kind,
          toImport.slice(i, i + BATCH).map((r) => r.record)
        );
        if (res.error) throw new Error(res.error);
        inserted += res.inserted;
        skipped += res.skipped;
        setProgress(Math.min(toImport.length, i + BATCH));
      }
      setResult({ inserted, skipped });
      setStep('done');
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : "L'import a échoué.") +
          (inserted > 0 ? ` (${inserted} ${label.plural} déjà importés avant l'erreur.)` : '')
      );
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    const blob = new Blob([templateCsv(kind)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `modele-import-${kind}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <Stepper step={step} />

      {error && (
        <div role="alert" className="flex gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {step === 'upload' && (
        <div className="card p-5 sm:p-6 space-y-5">
          <label
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors ${
              busy ? 'border-gray-200 bg-gray-50' : 'border-gray-300 hover:border-kf-navy/40 hover:bg-gray-50 cursor-pointer'
            }`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void handleFile(e.dataTransfer.files?.[0]);
            }}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-kf-navy/[0.07] text-kf-navy">
              <IconDocument className="h-5 w-5" />
            </span>
            <span className="text-sm font-medium text-gray-900">
              {busy ? 'Lecture du fichier...' : 'Choisir un fichier Excel ou CSV'}
            </span>
            <span className="text-xs text-gray-500">Formats acceptés : .xlsx, .csv (15 Mo maximum)</span>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="sr-only"
              disabled={busy}
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <div className="rounded-lg bg-gray-50 p-4">
              <p className="font-medium text-gray-900">Votre fichier tel quel</p>
              <p className="mt-1 text-gray-600">
                Les colonnes (entreprise, contact, téléphone, email, secteur{kind === 'prospects' ? ', statut, relance' : ''}...) sont
                reconnues automatiquement. Vous pourrez corriger avant d&apos;importer.
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 p-4">
              <p className="font-medium text-gray-900">Pas encore de fichier ?</p>
              <p className="mt-1 text-gray-600">Partez du modèle, remplissez-le dans Excel puis importez-le.</p>
              <button type="button" onClick={downloadTemplate} className="btn-link mt-2">
                Télécharger le modèle
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Le fichier est lu sur votre appareil. Les {label.plural} importés vous sont attribués : vous seul (et la
            direction) les voyez. Les fichiers PDF ne peuvent pas être importés automatiquement.
          </p>
        </div>
      )}

      {step === 'map' && sheet && (
        <div className="space-y-4">
          <div className="card p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm text-gray-600">
                Fichier : <span className="font-medium text-gray-900">{fileName}</span>
              </p>
              <button type="button" className="btn-link" onClick={() => setStep('upload')}>
                Changer de fichier
              </button>
            </div>
            {sheets.length > 1 && (
              <div>
                <label className="field-label" htmlFor="sheet">
                  Onglet à importer
                </label>
                <select
                  id="sheet"
                  className="input mt-1"
                  value={sheetIndex}
                  onChange={(e) => selectSheet(Number(e.target.value))}
                >
                  {sheets.map((s, i) => {
                    const n = countContactLikeRows(s.rows);
                    return (
                      <option key={s.name + i} value={i}>
                        {s.name} ({n > 0 ? `${n} contact${n > 1 ? 's' : ''} détecté${n > 1 ? 's' : ''}` : 'aucun contact détecté'})
                      </option>
                    );
                  })}
                </select>
              </div>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="card-header">
              <div>
                <h2 className="card-title">Correspondance des colonnes</h2>
                <p className="text-xs text-gray-500 mt-0.5">Vérifiez ce que contient chaque colonne de votre fichier.</p>
              </div>
            </div>
            <ul className="divide-y divide-gray-100">
              {headers.map((h, i) => {
                const samples = sheet.rows
                  .slice(headerRow + 1)
                  .map((r) => r[i])
                  .filter(Boolean)
                  .slice(0, 2);
                if (!h && samples.length === 0) return null;
                return (
                  <li key={i} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_260px] sm:items-center sm:px-5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{h || `Colonne ${i + 1} (sans titre)`}</p>
                      <p className="text-xs text-gray-500 truncate">{samples.join(' · ') || 'vide'}</p>
                    </div>
                    <select
                      aria-label={`Contenu de la colonne ${h}`}
                      className={`input ${mapping[i] === 'ignore' ? 'text-gray-400' : ''}`}
                      value={mapping[i] ?? 'ignore'}
                      onChange={(e) =>
                        setMapping((m) => m.map((v, j) => (j === i ? (e.target.value as FieldKey) : v)))
                      }
                    >
                      {fieldsFor(kind).map((f) => (
                        <option key={f} value={f}>
                          {FIELD_LABELS[f]}
                        </option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex justify-end">
            <button type="button" className="btn-primary" disabled={busy} onClick={goToPreview}>
              {busy ? 'Vérification des doublons...' : 'Voir l’aperçu'}
              {!busy && <IconChevronRight className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Summary label="Prêts à importer" value={toImport.length} tone="text-emerald-700" />
            <Summary label="Déjà dans vos contacts" value={issueCounts.exists_mine ?? 0} />
            <Summary label="Suivis par un collègue" value={issueCounts.exists_other ?? 0} />
            <Summary
              label="Ignorés (doublons, exemple, incomplets)"
              value={(issueCounts.duplicate_in_file ?? 0) + (issueCounts.example ?? 0) + (issueCounts.no_identity ?? 0)}
            />
          </div>
          {(issueCounts.exists_other ?? 0) > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              Certains numéros sont déjà suivis par un autre commercial. Ils ne seront pas importés : voyez avec votre manager
              qui garde ces contacts.
            </p>
          )}

          <div className="card overflow-hidden">
            <div className="card-header">
              <h2 className="card-title">Aperçu</h2>
              <span className="text-xs text-gray-500">{prepared.length} lignes lues</span>
            </div>
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Ligne</th>
                    <th className="px-3 py-2 font-medium">Nom</th>
                    <th className="px-3 py-2 font-medium hidden sm:table-cell">Téléphone</th>
                    {kind === 'prospects' && <th className="px-3 py-2 font-medium hidden md:table-cell">Statut</th>}
                    <th className="px-4 py-2 font-medium text-right">Import</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {prepared.map((r) => (
                    <tr key={r.line} className={r.issue ? 'text-gray-400' : ''}>
                      <td className="num px-4 py-2.5 text-xs">{r.line}</td>
                      <td className="px-3 py-2.5">
                        <span className={`block truncate max-w-[220px] sm:max-w-[320px] ${r.issue ? '' : 'font-medium text-gray-900'}`}>
                          {displayName(r.record) || 'Sans nom'}
                        </span>
                        {r.record.contactName && (
                          <span className="block truncate max-w-[220px] sm:max-w-[320px] text-xs text-gray-500">
                            {r.record.contactName}
                          </span>
                        )}
                        <span className="block text-xs text-gray-500 sm:hidden">{r.record.phone}</span>
                      </td>
                      <td className="num px-3 py-2.5 whitespace-nowrap hidden sm:table-cell">{r.record.phone || '-'}</td>
                      {kind === 'prospects' && (
                        <td className="px-3 py-2.5 hidden md:table-cell">{STATUS_LABELS[r.record.status]}</td>
                      )}
                      <td className="px-4 py-2.5 text-right">
                        {r.issue ? (
                          <span className="badge-gray">{ISSUE_LABELS[r.issue]}</span>
                        ) : (
                          <span className="badge-green">À importer</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setStep('map')}>
              Modifier les colonnes
            </button>
            <button type="button" className="btn-primary" disabled={busy || toImport.length === 0} onClick={runImport}>
              {busy
                ? `Import en cours... ${progress}/${toImport.length}`
                : `Importer ${toImport.length} ${label.plural}`}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="card p-6 text-center space-y-3">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <IconCheck className="h-5 w-5" />
          </span>
          <p className="text-lg font-semibold text-gray-900">
            {result.inserted} {label.plural} importés
          </p>
          {result.skipped > 0 && (
            <p className="text-sm text-gray-500">{result.skipped} ligne(s) ignorée(s) car déjà présentes.</p>
          )}
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Link href={label.back} className="btn-primary">
              Voir mes {label.plural}
            </Link>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setStep('upload');
                setSheets([]);
                setPrepared([]);
                setResult(null);
              }}
            >
              Importer un autre fichier
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'upload', label: 'Fichier' },
    { key: 'map', label: 'Colonnes' },
    { key: 'preview', label: 'Aperçu' },
    { key: 'done', label: 'Terminé' },
  ];
  const current = steps.findIndex((s) => s.key === step);
  return (
    <ol className="flex items-center gap-2 text-xs">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
              i < current ? 'bg-emerald-600 text-white' : i === current ? 'bg-kf-navy text-white' : 'bg-gray-200 text-gray-500'
            }`}
          >
            {i < current ? <IconCheck className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className={`hidden sm:inline ${i === current ? 'font-medium text-gray-900' : 'text-gray-500'}`}>{s.label}</span>
          {i < steps.length - 1 && <span className="h-px w-4 sm:w-8 bg-gray-300" />}
        </li>
      ))}
    </ol>
  );
}

function Summary({ label, value, tone = 'text-gray-900' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="card p-4">
      <p className={`num text-2xl font-semibold ${tone}`}>{value}</p>
      <p className="mt-0.5 text-xs text-gray-500 leading-snug">{label}</p>
    </div>
  );
}
