'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createUserRequest } from '@/lib/users/requests';
import { DEPARTMENTS, roleLabel, type Department, type UserRole } from '@/lib/users/roles';

// Formulaire de demande d'inscription. `departments` = départements que
// l'utilisateur peut demander (le sien pour un chef de service, tous pour la
// direction).
export function RequestForm({ departments }: { departments: Department[] }) {
  const router = useRouter();
  const options = DEPARTMENTS.filter((d) => departments.includes(d.value));
  const [department, setDepartment] = useState<Department>(options[0]?.value ?? 'commercial');
  const roles = DEPARTMENTS.find((d) => d.value === department)?.roles ?? [];
  const [role, setRole] = useState<UserRole>(roles[0] ?? 'commercial');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function changeDepartment(value: Department) {
    setDepartment(value);
    setRole(DEPARTMENTS.find((d) => d.value === value)?.roles[0] ?? 'commercial');
  }

  function submit() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await createUserRequest({ fullName, email, phone, role, department, note });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push('/users/demandes');
      router.refresh();
    });
  }

  return (
    <div className="card p-4 space-y-3 max-w-xl">
      {options.length > 1 ? (
        <label className="block text-xs text-gray-500">
          Département
          <select value={department} onChange={(e) => changeDepartment(e.target.value as Department)} className="input mt-1">
            {options.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-sm text-gray-600">
          Département : <span className="font-medium text-gray-900">{options[0]?.label}</span>
        </p>
      )}
      <label className="block text-xs text-gray-500">
        Poste
        <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className="input mt-1">
          {roles.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-gray-500">
        Nom complet de l&apos;agent
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="input mt-1" />
      </label>
      <label className="block text-xs text-gray-500">
        E-mail (identifiant de connexion)
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input mt-1" />
      </label>
      <label className="block text-xs text-gray-500">
        Téléphone (optionnel)
        <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input mt-1" />
      </label>
      <label className="block text-xs text-gray-500">
        Commentaire pour la direction (optionnel)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="input mt-1" />
      </label>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button type="button" onClick={submit} disabled={isPending} className="btn-primary w-full justify-center">
        {isPending ? 'Envoi...' : 'Envoyer la demande à la direction'}
      </button>
    </div>
  );
}
