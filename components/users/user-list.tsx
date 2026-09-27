'use client';

import { useState, useTransition } from 'react';
import { updateUserRole, toggleUserActive, updateUserProfile } from '@/lib/users/actions';
import { roleLabel, ALL_ROLES, type UserRole } from '@/lib/users/roles';

type UserRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
};

export function UserList({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  const [rows, setRows] = useState(users);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');

  function handleRoleChange(userId: string, role: UserRole) {
    setError(null);
    startTransition(async () => {
      try {
        await updateUserRole(userId, role);
        setRows((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur');
      }
    });
  }

  function handleToggleActive(userId: string, isActive: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        await toggleUserActive(userId, isActive);
        setRows((prev) => prev.map((u) => (u.id === userId ? { ...u, is_active: isActive } : u)));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur');
      }
    });
  }

  function startEditing(u: UserRow) {
    setError(null);
    setEditingId(u.id);
    setEditFullName(u.full_name ?? '');
    setEditEmail(u.email ?? '');
    setEditPhone(u.phone ?? '');
  }

  function handleSaveProfile(userId: string) {
    setError(null);
    startTransition(async () => {
      try {
        await updateUserProfile(userId, { fullName: editFullName, email: editEmail, phone: editPhone });
        setRows((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, full_name: editFullName, email: editEmail, phone: editPhone } : u))
        );
        setEditingId(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur');
      }
    });
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{error}</p>}
      {rows.map((u) => {
        const isSelf = u.id === currentUserId;
        const isEditing = editingId === u.id;
        return (
          <div key={u.id} className="bg-white rounded-lg border p-3 space-y-2">
            {isEditing ? (
              <div className="space-y-2">
                <label className="text-xs text-gray-500 block">
                  Nom complet
                  <input
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
                  />
                </label>
                <label className="text-xs text-gray-500 block">
                  Email
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
                  />
                </label>
                <label className="text-xs text-gray-500 block">
                  Téléphone
                  <input
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    disabled={isPending}
                    onClick={() => handleSaveProfile(u.id)}
                    className="flex-1 bg-kf-navy text-white rounded-md py-2 text-sm disabled:opacity-60"
                  >
                    {isPending ? 'Enregistrement...' : 'Enregistrer'}
                  </button>
                  <button
                    disabled={isPending}
                    onClick={() => setEditingId(null)}
                    className="flex-1 border rounded-md py-2 text-sm"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">
                      {u.full_name} {isSelf && <span className="text-xs text-gray-400">(vous)</span>}
                    </p>
                    <p className="text-xs text-gray-500">{u.email}</p>
                    {u.phone && <p className="text-xs text-gray-500">{u.phone}</p>}
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      u.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {u.is_active ? 'Actif' : 'Désactivé'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={u.role}
                    disabled={isSelf || isPending}
                    onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                    className="flex-1 border rounded-md px-2 py-1.5 text-sm disabled:bg-gray-50"
                  >
                    {ALL_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {roleLabel(r)}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={isPending}
                    onClick={() => startEditing(u)}
                    className="text-xs border rounded-md px-3 py-1.5 disabled:opacity-40"
                  >
                    Modifier
                  </button>
                  <button
                    disabled={isSelf || isPending}
                    onClick={() => handleToggleActive(u.id, !u.is_active)}
                    className="text-xs border rounded-md px-3 py-1.5 disabled:opacity-40"
                  >
                    {u.is_active ? 'Désactiver' : 'Réactiver'}
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
