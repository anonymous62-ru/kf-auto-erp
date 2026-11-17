'use client';

import { useState, useTransition } from 'react';
import {
  updateUserRole,
  toggleUserActive,
  updateUserProfile,
  getUserDeletionPreview,
  deleteUserAccount,
  type DeletionPreview,
} from '@/lib/users/actions';
import { roleLabel, ALL_ROLES, DEPARTMENTS, departmentLabel, type UserRole } from '@/lib/users/roles';

type UserRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  department?: string | null;
  is_active: boolean;
  created_at: string;
  deleted_at?: string | null;
};

const OWNED_LABELS: Record<string, string> = {
  clients: 'client(s)',
  prospects_clients: 'prospect(s) du fichier clients',
  leads: 'lead(s)',
  documents: 'proforma(s) ou bon(s) de commande en cours',
  affaires: 'affaire(s) ouverte(s)',
  rendez_vous: 'rendez-vous prévu(s)',
  actions: 'action(s) en attente',
};

export function UserList({
  users,
  currentUserId,
  currentUserRole,
}: {
  users: UserRow[];
  currentUserId: string;
  currentUserRole?: string | null;
}) {
  const [rows, setRows] = useState<(UserRow & { pendingRole?: UserRole })[]>(users);
  const [notice, setNotice] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [transferTo, setTransferTo] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');

  function handleRoleChange(userId: string, role: UserRole, department?: string | null) {
    setError(null);
    // Un chef de service doit avoir un département : on attend qu'il soit choisi.
    if (role === 'chef_service' && !department) {
      setRows((prev) => prev.map((u) => (u.id === userId ? { ...u, pendingRole: role } : u)));
      return;
    }
    startTransition(async () => {
      try {
        await updateUserRole(userId, role, department);
        setRows((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role, department: department ?? null, pendingRole: undefined } : u))
        );
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

  function startDeleting(u: UserRow) {
    setError(null);
    setNotice(null);
    setEditingId(null);
    setDeletingId(u.id);
    setPreview(null);
    setTransferTo('');
    setConfirmName('');
    setUnderstood(false);
    startTransition(async () => {
      const res = await getUserDeletionPreview(u.id);
      if (res.error) {
        setError(res.error);
        setDeletingId(null);
        return;
      }
      setPreview(res.preview ?? null);
    });
  }

  function handleDelete(u: UserRow, retry = false) {
    if (isPending) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await deleteUserAccount(u.id, retry ? null : transferTo || null, retry ? u.full_name : confirmName);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.result === 'supprime') {
        setRows((prev) => prev.filter((r) => r.id !== u.id));
        setNotice(`Le compte de ${u.full_name} a été supprimé définitivement (aucun historique).`);
      } else {
        setRows((prev) =>
          prev.map((r) =>
            r.id === u.id ? { ...r, is_active: false, deleted_at: new Date().toISOString(), email: null, phone: null } : r
          )
        );
        setNotice(
          `Le compte de ${u.full_name} a été supprimé : il ne peut plus se connecter. Son nom reste visible dans l'historique (documents signés, paiements, journal).`
        );
      }
      setDeletingId(null);
    });
  }

  function canDeleteRow(u: UserRow) {
    if (u.id === currentUserId) return false;
    if (u.role === 'super_admin' && currentUserRole !== 'super_admin') return false;
    if (u.role === 'administrateur' && !['super_admin', 'administrateur'].includes(currentUserRole ?? '')) return false;
    return true;
  }

  const activeRows = rows.filter((u) => !u.deleted_at);
  const deletedRows = rows.filter((u) => !!u.deleted_at);

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
      {notice && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md p-2">{notice}</p>}
      {activeRows.map((u) => {
        const isSelf = u.id === currentUserId;
        const isEditing = editingId === u.id;
        const isDeleting = deletingId === u.id;
        const colleagues = activeRows
          .filter((c) => c.id !== u.id && c.is_active)
          .sort((a, b) => Number(b.role === u.role) - Number(a.role === u.role) || a.full_name.localeCompare(b.full_name));
        const nameMatches =
          confirmName.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr') ===
          u.full_name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');
        const needsTransfer = (preview?.owned_total ?? 0) > 0;
        const canConfirm =
          !!preview && !preview.last_super_admin && nameMatches && understood && (!needsTransfer || !!transferTo);
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
                    {u.role === 'chef_service' && u.department && (
                      <p className="text-xs text-gray-500">Département : {departmentLabel(u.department)}</p>
                    )}
                    {u.phone && <p className="text-xs text-gray-500">{u.phone}</p>}
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded-md ${
                      u.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {u.is_active ? 'Actif' : 'Désactivé'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={u.pendingRole ?? u.role}
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
                  {(u.pendingRole ?? u.role) === 'chef_service' && !isSelf && (
                    <select
                      value={u.department ?? ''}
                      disabled={isPending}
                      onChange={(e) => handleRoleChange(u.id, 'chef_service', e.target.value || null)}
                      className="border rounded-md px-2 py-1.5 text-sm"
                    >
                      <option value="">Département...</option>
                      {DEPARTMENTS.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  )}
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
                  {canDeleteRow(u) && (
                    <button
                      disabled={isPending}
                      onClick={() => (isDeleting ? setDeletingId(null) : startDeleting(u))}
                      className="text-xs border border-red-200 text-red-700 rounded-md px-3 py-1.5 disabled:opacity-40"
                    >
                      Supprimer
                    </button>
                  )}
                </div>
                {isDeleting && (
                  <div className="border border-red-200 bg-red-50 rounded-md p-3 space-y-2 text-sm">
                    <p className="font-medium text-red-800">Supprimer le compte de {u.full_name}</p>
                    {!preview ? (
                      <p className="text-xs text-gray-600">Vérification des données liées...</p>
                    ) : preview.last_super_admin ? (
                      <p className="text-xs text-red-700">Impossible : c&apos;est le dernier super admin.</p>
                    ) : (
                      <>
                        <p className="text-xs text-gray-700">
                          La personne ne pourra plus se connecter. Pour une absence temporaire, utilisez plutôt
                          « Désactiver ».
                        </p>
                        {needsTransfer ? (
                          <div className="space-y-1">
                            <p className="text-xs text-gray-700">
                              À transférer :{' '}
                              {Object.entries(preview.owned)
                                .filter(([, n]) => n > 0)
                                .map(([k, n]) => `${n} ${OWNED_LABELS[k] ?? k}`)
                                .join(', ')}
                              .
                            </p>
                            <label className="text-xs text-gray-600 block">
                              Collègue qui reprend ces dossiers
                              <select
                                value={transferTo}
                                disabled={isPending}
                                onChange={(e) => setTransferTo(e.target.value)}
                                className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5 bg-white"
                              >
                                <option value="">Choisir un collègue...</option>
                                {colleagues.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.full_name} ({roleLabel(c.role)})
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        ) : (
                          <p className="text-xs text-gray-700">Aucun client ni dossier en cours à transférer.</p>
                        )}
                        <p className="text-xs text-gray-700">
                          {preview.history > 0
                            ? "Son nom reste visible dans l'historique (documents signés ou validés, paiements, journal d'audit) ; ses coordonnées sont effacées."
                            : 'Aucun historique : le compte sera effacé entièrement.'}
                        </p>
                        <label className="text-xs text-gray-600 block">
                          Pour confirmer, retapez le nom complet : <strong>{u.full_name}</strong>
                          <input
                            value={confirmName}
                            disabled={isPending}
                            onChange={(e) => setConfirmName(e.target.value)}
                            className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5 bg-white"
                          />
                        </label>
                        <label className="flex items-center gap-2 text-xs text-gray-700">
                          <input
                            type="checkbox"
                            checked={understood}
                            disabled={isPending}
                            onChange={(e) => setUnderstood(e.target.checked)}
                          />
                          Je comprends que cette suppression est définitive.
                        </label>
                      </>
                    )}
                    <div className="flex gap-2">
                      <button
                        disabled={isPending || !canConfirm}
                        onClick={() => handleDelete(u)}
                        className="flex-1 bg-red-700 text-white rounded-md py-2 text-sm disabled:opacity-50"
                      >
                        {isPending ? 'Suppression...' : 'Supprimer définitivement'}
                      </button>
                      <button
                        disabled={isPending}
                        onClick={() => setDeletingId(null)}
                        className="flex-1 border rounded-md py-2 text-sm bg-white"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
      {deletedRows.length > 0 && (
        <details className="bg-white rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer text-gray-600">
            Comptes supprimés, historique conservé ({deletedRows.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {deletedRows.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 text-xs text-gray-500">
                <span>
                  {u.full_name} ({roleLabel(u.role)})
                </span>
                {canDeleteRow(u) && (
                  <button
                    disabled={isPending}
                    onClick={() => handleDelete(u, true)}
                    className="border rounded-md px-2 py-1 disabled:opacity-40"
                    title="À utiliser si la suppression de l'accès avait échoué"
                  >
                    Relancer la suppression
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
