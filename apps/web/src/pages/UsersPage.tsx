import React, { useEffect, useState } from 'react';
import { Users, Plus, KeyRound, Unlock, Shield, Search } from 'lucide-react';
import { ApiClient } from '../api/client.js';
import { Modal } from '../components/Modal.js';
import { UserSummary, RoleSummary, ClientWithCredentialInfo, PERMISSIONS } from '@hmc/shared';
import { useAuth } from '../context/AuthContext.js';

export const UsersPage: React.FC = () => {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [clients, setClients] = useState<ClientWithCredentialInfo[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserSummary | null>(null);

  const [createForm, setCreateForm] = useState({
    username: '',
    email: '',
    fullName: '',
    password: '',
    roleIds: [] as string[],
    assignedClientIds: [] as string[],
  });

  const [newPassword, setNewPassword] = useState('');
  const { hasPermission } = useAuth();

  const loadData = async () => {
    try {
      setLoading(true);
      const [usersData, rolesData, clientsData] = await Promise.all([
        ApiClient.request<UserSummary[]>('/users'),
        ApiClient.request<RoleSummary[]>('/rbac/roles'),
        ApiClient.request<ClientWithCredentialInfo[]>('/clients'),
      ]);
      setUsers(usersData || []);
      setRoles(rolesData || []);
      setClients(clientsData || []);
    } catch (err) {
      console.error('Failed to load users data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (createForm.roleIds.length === 0) {
      alert('Please assign at least one role');
      return;
    }

    try {
      await ApiClient.request('/users', {
        method: 'POST',
        body: JSON.stringify(createForm),
      });
      setIsCreateModalOpen(false);
      setCreateForm({
        username: '',
        email: '',
        fullName: '',
        password: '',
        roleIds: [],
        assignedClientIds: [],
      });
      await loadData();
    } catch (err: any) {
      alert(`Error creating user: ${err.message}`);
    }
  };

  const handleUnlockUser = async (user: UserSummary) => {
    try {
      await ApiClient.request(`/users/${user.id}/unlock`, { method: 'POST' });
      await loadData();
      alert(`User ${user.username} unlocked successfully.`);
    } catch (err: any) {
      alert(`Unlock failed: ${err.message}`);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    try {
      await ApiClient.request('/auth/admin-reset-password', {
        method: 'POST',
        body: JSON.stringify({
          userId: selectedUser.id,
          newPassword,
          requirePasswordChangeOnLogin: true,
        }),
      });
      setIsResetModalOpen(false);
      setNewPassword('');
      alert(`Password for ${selectedUser.username} has been reset.`);
    } catch (err: any) {
      alert(`Password reset failed: ${err.message}`);
    }
  };

  const filteredUsers = users.filter(
    (u) =>
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.fullName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Console Application Users</h2>
          <p className="text-xs text-slate-400">Manage operator accounts, assigned roles, and client-level access control</p>
        </div>

        {hasPermission(PERMISSIONS.APPLICATION_USER_MANAGE) && (
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-semibold shadow-lg shadow-sky-900/30 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create User
          </button>
        )}
      </div>

      {/* Search Bar */}
      <div className="flex items-center gap-3 bg-surface p-3.5 rounded-xl border border-surface-border">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by username, full name, or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 bg-slate-900 border border-slate-700/80 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-surface border border-surface-border rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-900/80 border-b border-surface-border text-slate-400 uppercase tracking-wider font-semibold">
              <th className="py-3 px-4">User Details</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Roles</th>
              <th className="py-3 px-4">Client Access Scope</th>
              <th className="py-3 px-4">Last Login</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-500">Loading user accounts...</td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-500">No users found.</td>
              </tr>
            ) : (
              filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-slate-900/40 transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="font-semibold text-white">{user.fullName}</div>
                    <div className="text-[11px] font-mono text-sky-400">{user.username}</div>
                    <div className="text-[11px] text-slate-400">{user.email}</div>
                  </td>

                  <td className="py-3.5 px-4">
                    <span
                      className={`px-2.5 py-0.5 rounded-full font-semibold text-[11px] ${
                        user.status === 'ACTIVE'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : user.status === 'LOCKED'
                          ? 'bg-red-950 text-red-400 border border-red-800'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {user.status}
                    </span>
                  </td>

                  <td className="py-3.5 px-4">
                    <div className="flex flex-wrap gap-1">
                      {user.roles.map((r) => (
                        <span key={r.id} className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 text-[10px]">
                          {r.name}
                        </span>
                      ))}
                    </div>
                  </td>

                  <td className="py-3.5 px-4 font-mono text-[11px] text-slate-400">
                    {user.roles.some((r) => r.name === 'Super Admin') ? (
                      <span className="text-emerald-400 font-semibold">ALL CLIENTS (Universal)</span>
                    ) : user.assignedClientIds.length > 0 ? (
                      <span>{user.assignedClientIds.length} Assigned Client(s)</span>
                    ) : (
                      <span className="text-slate-500">None</span>
                    )}
                  </td>

                  <td className="py-3.5 px-4 text-slate-400 font-mono text-[11px]">
                    {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}
                  </td>

                  <td className="py-3.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {user.status === 'LOCKED' && (
                        <button
                          onClick={() => handleUnlockUser(user)}
                          title="Unlock Locked Account"
                          className="p-1.5 text-emerald-400 hover:bg-emerald-950/50 rounded-lg transition-colors"
                        >
                          <Unlock className="w-4 h-4" />
                        </button>
                      )}

                      <button
                        onClick={() => {
                          setSelectedUser(user);
                          setIsResetModalOpen(true);
                        }}
                        title="Admin Password Reset"
                        className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg transition-colors"
                      >
                        <KeyRound className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create User Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create Console Application User"
      >
        <form onSubmit={handleCreateUser} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Username</label>
              <input
                type="text"
                required
                value={createForm.username}
                onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Email</label>
              <input
                type="email"
                required
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Full Name</label>
            <input
              type="text"
              required
              value={createForm.fullName}
              onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Initial Password</label>
            <input
              type="password"
              required
              value={createForm.password}
              onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
              placeholder="Min 10 chars with Upper, Lower, Number, Symbol"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Assign Roles</label>
            <div className="space-y-1 max-h-32 overflow-y-auto border border-slate-700 p-2 rounded-lg bg-slate-900">
              {roles.map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createForm.roleIds.includes(r.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setCreateForm({ ...createForm, roleIds: [...createForm.roleIds, r.id] });
                      } else {
                        setCreateForm({ ...createForm, roleIds: createForm.roleIds.filter((id) => id !== r.id) });
                      }
                    }}
                  />
                  <span>{r.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Assign Client Access</label>
            <div className="space-y-1 max-h-32 overflow-y-auto border border-slate-700 p-2 rounded-lg bg-slate-900">
              {clients.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createForm.assignedClientIds.includes(c.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setCreateForm({ ...createForm, assignedClientIds: [...createForm.assignedClientIds, c.id] });
                      } else {
                        setCreateForm({ ...createForm, assignedClientIds: createForm.assignedClientIds.filter((id) => id !== c.id) });
                      }
                    }}
                  />
                  <span>[{c.clientCode}] {c.clientName}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-surface-border">
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(false)}
              className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-xs hover:bg-slate-700"
            >
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 bg-sky-600 text-white rounded-lg text-xs font-semibold hover:bg-sky-500">
              Create User
            </button>
          </div>
        </form>
      </Modal>

      {/* Admin Reset Password Modal */}
      <Modal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        title={`Reset Password: ${selectedUser?.username}`}
      >
        <form onSubmit={handleResetPassword} className="space-y-4">
          <p className="text-xs text-slate-300">
            Set a new temporary password for this user. The account will be unlocked and forced to change password upon next login.
          </p>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">New Password</label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-surface-border">
            <button
              type="button"
              onClick={() => setIsResetModalOpen(false)}
              className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-xs hover:bg-slate-700"
            >
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-500">
              Reset Password
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
