import React, { useEffect, useState } from 'react';
import { Shield, Check, Lock } from 'lucide-react';
import { ApiClient } from '../api/client.js';
import { RoleSummary, PermissionDefinition } from '@hmc/shared';

export const RolesPage: React.FC = () => {
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [permissions, setPermissions] = useState<PermissionDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [rolesData, permsData] = await Promise.all([
          ApiClient.request<RoleSummary[]>('/rbac/roles'),
          ApiClient.request<PermissionDefinition[]>('/rbac/permissions'),
        ]);
        setRoles(rolesData || []);
        setPermissions(permsData || []);
      } catch (err) {
        console.error('Failed to load RBAC matrix', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Group permissions by category
  const categories = Array.from(new Set(permissions.map((p) => p.category)));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">Role-Based Access Control (RBAC) Matrix</h2>
        <p className="text-xs text-slate-400">
          Granular permission matrix enforced at API endpoint and frontend interface boundaries
        </p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-500 text-xs">Loading RBAC matrix...</div>
      ) : (
        <div className="bg-surface border border-surface-border rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-900/90 border-b border-surface-border text-slate-400">
                  <th className="py-3 px-4 font-semibold w-72">Permission & Code</th>
                  {roles.map((r) => (
                    <th key={r.id} className="py-3 px-3 text-center font-semibold text-white min-w-[120px]">
                      <div>{r.name}</div>
                      <div className="text-[10px] text-slate-500 font-normal">
                        {r.isSystem ? 'System Role' : 'Custom'}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {categories.map((category) => {
                  const categoryPerms = permissions.filter((p) => p.category === category);
                  return (
                    <React.Fragment key={category}>
                      <tr className="bg-slate-900/40 font-semibold text-sky-400">
                        <td colSpan={roles.length + 1} className="py-2.5 px-4 uppercase text-[11px] tracking-wider">
                          {category}
                        </td>
                      </tr>

                      {categoryPerms.map((perm) => (
                        <tr key={perm.code} className="hover:bg-slate-900/20 transition-colors">
                          <td className="py-2 px-4">
                            <div className="font-medium text-slate-200">{perm.name}</div>
                            <div className="font-mono text-[10px] text-slate-500">{perm.code}</div>
                          </td>

                          {roles.map((role) => {
                            const isSuperAdmin = role.name === 'Super Admin';
                            const hasPerm = isSuperAdmin || role.permissions?.includes(perm.code);
                            return (
                              <td key={role.id} className="py-2 px-3 text-center">
                                {hasPerm ? (
                                  <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800">
                                    <Check className="w-3.5 h-3.5" />
                                  </span>
                                ) : (
                                  <span className="text-slate-700">-</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
