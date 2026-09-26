'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createUser } from '@/lib/users/actions';
import { roleLabel, ALL_ROLES, type UserRole } from '@/lib/users/roles';
import { IconCheck } from '@/components/icons';

function generatePassword() {
  // mot de passe temporaire lisible, a communiquer au commercial (a changer a la 1ere connexion)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export function UserForm({ canCreateAdmins }: { canCreateAdmins: boolean }) {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('commercial');
  const [password, setPassword] = useState(generatePassword());
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const [isPending, startTransition] = useTransition();

  const availableRoles = canCreateAdmins ? ALL_ROLES : ALL_ROLES.filter((r) => !['super_admin', 'administrateur'].includes(r));

  function handleSubmit() {
    setError(null);
    if (!fullName.trim() || !email.trim() || !password.trim()) {
      setError('Nom complet, email et mot de passe sont obligatoires.');
      return;
    }
    startTransition(async () => {
      try {
        await createUser({ fullName, email, phone: phone || undefined, role, password });
        setCreated(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur lors de la création');
      }
    });
  }

  if (created) {
    return (
      <div className="bg-white rounded-lg border p-4 space-y-3">
        <p className="text-sm font-medium text-green-700 flex items-center gap-1.5"><IconCheck className="w-4 h-4" /> Compte créé</p>
        <p className="text-sm text-gray-600">
          Communiquez ces identifiants à <strong>{fullName}</strong> (à changer dès la première connexion) :
        </p>
        <div className="bg-gray-50 rounded-md p-3 text-sm space-y-1">
          <p>
            <span className="text-gray-500">Email :</span> {email}
          </p>
          <p>
            <span className="text-gray-500">Mot de passe :</span> {password}
          </p>
        </div>
        <button onClick={() => router.push('/users')} className="w-full bg-kf-navy text-white rounded-md py-2.5 text-sm font-medium">
          Retour à la liste
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg border p-3 space-y-2">
        <label className="block text-xs text-gray-500">
          Nom complet
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
        </label>
        <label className="block text-xs text-gray-500">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
          />
        </label>
        <label className="block text-xs text-gray-500">
          Téléphone (optionnel)
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
        </label>
        <label className="block text-xs text-gray-500">
          Rôle
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5">
            {availableRoles.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-gray-500">
          Mot de passe temporaire
          <div className="flex gap-2 mt-0.5">
            <input value={password} onChange={(e) => setPassword(e.target.value)} className="flex-1 border rounded-md px-2 py-1.5 text-sm" />
            <button type="button" onClick={() => setPassword(generatePassword())} className="text-xs border rounded-md px-2">
              Régénérer
            </button>
          </div>
        </label>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={isPending}
        className="w-full bg-kf-navy text-white rounded-md py-3 text-sm font-medium disabled:opacity-50"
      >
        {isPending ? 'Création...' : 'Créer ce compte'}
      </button>
    </div>
  );
}
