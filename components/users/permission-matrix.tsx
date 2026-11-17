'use client';

import { useRef, useState } from 'react';
import { resetRolePermissions, setRolePermission } from '@/lib/users/permission-actions';
import { PERMISSIONS } from '@/lib/users/permission-catalog';
import { ALL_ROLES, roleLabel } from '@/lib/users/roles';

export interface MatrixCell {
  role: string;
  permission: string;
  allowed: boolean;
  defaultAllowed: boolean;
}

const key = (role: string, permission: string) => `${role}:${permission}`;

export function PermissionMatrix({ cells }: { cells: MatrixCell[] }) {
  const [values, setValues] = useState<Record<string, MatrixCell>>(() =>
    Object.fromEntries(cells.map((c) => [key(c.role, c.permission), c]))
  );
  // Anti double clic : une case (ou un rôle entier) en cours d'enregistrement
  // est désactivée ; le verrou ref évite deux envois avant le nouveau rendu.
  const [pending, setPending] = useState<Set<string>>(new Set());
  const inFlight = useRef<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const roles = ALL_ROLES.filter((r) => cells.some((c) => c.role === r));

  function lock(id: string) {
    if (inFlight.current.has(id)) return false;
    inFlight.current.add(id);
    setPending((prev) => new Set(prev).add(id));
    return true;
  }
  function unlock(id: string) {
    inFlight.current.delete(id);
    setPending((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function toggle(role: string, permission: string) {
    const id = key(role, permission);
    const cell = values[id];
    if (!cell || role === 'super_admin' || inFlight.current.has(`role:${role}`)) return;
    if (!lock(id)) return;
    setError(null);
    setSaved(null);
    const next = !cell.allowed;
    const res = await setRolePermission(role, permission, next);
    if (res.error) {
      setError(res.error);
    } else {
      setValues((prev) => ({ ...prev, [id]: { ...prev[id], allowed: next } }));
      setSaved('Enregistré.');
    }
    unlock(id);
  }

  async function reset(role: string) {
    const id = `role:${role}`;
    if (PERMISSIONS.some((p) => inFlight.current.has(key(role, p.key)))) return;
    if (!lock(id)) return;
    setError(null);
    setSaved(null);
    const res = await resetRolePermissions(role);
    if (res.error) {
      setError(res.error);
    } else {
      setValues((prev) => {
        const next = { ...prev };
        for (const p of PERMISSIONS) {
          const k = key(role, p.key);
          if (next[k]) next[k] = { ...next[k], allowed: next[k].defaultAllowed };
        }
        return next;
      });
      setSaved(`${roleLabel(role)} : valeurs par défaut rétablies.`);
    }
    unlock(id);
  }

  return (
    <div className="space-y-3">
      <details className="bg-white rounded-lg border p-3 text-sm">
        <summary className="cursor-pointer font-medium">À quoi sert chaque droit ?</summary>
        <dl className="mt-2 space-y-1.5">
          {PERMISSIONS.map((p) => (
            <div key={p.key}>
              <dt className="font-medium text-gray-800">{p.label}</dt>
              <dd className="text-gray-600 text-xs">{p.help}</dd>
            </div>
          ))}
        </dl>
      </details>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{error}</p>}
      {saved && !error && <p className="text-xs text-green-700">{saved}</p>}

      <div className="bg-white rounded-lg border overflow-x-auto">
        <table className="text-xs min-w-full">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left p-2 sticky left-0 bg-gray-50 min-w-[180px]">Rôle</th>
              {PERMISSIONS.map((p) => (
                <th key={p.key} className="p-2 font-medium text-gray-700 align-bottom min-w-[96px]" title={p.help}>
                  {p.label}
                </th>
              ))}
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => {
              const isSuper = role === 'super_admin';
              const roleBusy = pending.has(`role:${role}`);
              const modifiedCount = PERMISSIONS.filter((p) => {
                const c = values[key(role, p.key)];
                return c && c.allowed !== c.defaultAllowed;
              }).length;
              return (
                <tr key={role} className="border-b last:border-b-0">
                  <th scope="row" className="text-left p-2 sticky left-0 bg-white font-medium text-gray-800">
                    {roleLabel(role)}
                    {isSuper && <span className="block text-[11px] font-normal text-gray-500">Tous les droits, non modifiable</span>}
                  </th>
                  {PERMISSIONS.map((p) => {
                    const id = key(role, p.key);
                    const c = values[id];
                    if (!c) return <td key={p.key} className="p-2" />;
                    const modified = !isSuper && c.allowed !== c.defaultAllowed;
                    const busy = pending.has(id) || roleBusy;
                    return (
                      <td key={p.key} className={`p-2 text-center ${modified ? 'bg-amber-50' : ''}`}>
                        <label className="inline-flex flex-col items-center gap-0.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={c.allowed}
                            disabled={isSuper || busy}
                            onChange={() => toggle(role, p.key)}
                            aria-label={`${p.label} pour ${roleLabel(role)}`}
                            className="h-4 w-4 disabled:opacity-60"
                          />
                          <span className={`text-[10px] ${modified ? 'text-amber-700' : 'text-gray-400'}`}>
                            {isSuper ? '' : busy ? '...' : modified ? 'modifié' : 'par défaut'}
                          </span>
                        </label>
                      </td>
                    );
                  })}
                  <td className="p-2 text-right whitespace-nowrap">
                    {!isSuper && (
                      <button
                        type="button"
                        disabled={roleBusy || modifiedCount === 0}
                        onClick={() => reset(role)}
                        className="text-xs border rounded-md px-2 py-1 disabled:opacity-40"
                      >
                        {roleBusy ? 'Rétablissement...' : 'Revenir aux valeurs par défaut'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
