import React, { useEffect, useState, useRef } from 'react';
import {
  Plus,
  KeyRound,
  ShieldAlert,
  Play,
  CheckCircle,
  XCircle,
  Edit2,
  RefreshCw,
  Search,
  Loader2,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { ApiClient } from '../api/client.js';
import { EnvironmentBadge } from '../components/EnvironmentBadge.js';
import { Modal } from '../components/Modal.js';
import { ClientWithCredentialInfo, ClientEnvironment, PERMISSIONS } from '@hmc/shared';
import { useAuth } from '../context/AuthContext.js';

interface LaunchToast {
  id: string;
  clientId: string;
  clientCode: string;
  clientName?: string;
  status: 'LAUNCHING' | 'SUCCESS' | 'REQUIRES_INTERVENTION' | 'ERROR';
  message: string;
  client: ClientWithCredentialInfo;
}

export const ClientsPage: React.FC = () => {
  const [clients, setClients] = useState<ClientWithCredentialInfo[]>([]);
  const [search, setSearch] = useState('');
  const [selectedEnv, setSelectedEnv] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCredModalOpen, setIsCredModalOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientWithCredentialInfo | null>(null);

  // Form states
  const [clientForm, setClientForm] = useState({
    clientCode: '',
    clientName: '',
    baseUrl: '',
    applicationPath: '/hmc',
    environment: 'Development' as ClientEnvironment,
    applicationVersion: 'v1.0',
    loginRoute: '/login',
    usersRoute: '/hmc/users',
    servicesRoute: '/hmc/services',
  });

  const [credForm, setCredForm] = useState({
    credentialName: 'Default HMC Operator',
    username: '',
    password: '',
  });

  // Fast non-blocking launch states
  const [toast, setToast] = useState<LaunchToast | null>(null);
  const [launchingClientIds, setLaunchingClientIds] = useState<Record<string, boolean>>({});
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const toastDismissTimerRef = useRef<NodeJS.Timeout | null>(null);
  const { hasPermission } = useAuth();

  const loadClients = async () => {
    try {
      setLoading(true);
      const data = await ApiClient.request<ClientWithCredentialInfo[]>('/clients');
      setClients(data || []);
    } catch (err) {
      console.error('Failed to load clients', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClients();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (toastDismissTimerRef.current) clearTimeout(toastDismissTimerRef.current);
    };
  }, []);

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await ApiClient.request('/clients', {
        method: 'POST',
        body: JSON.stringify(clientForm),
      });
      setIsCreateModalOpen(false);
      setClientForm({
        clientCode: '',
        clientName: '',
        baseUrl: '',
        applicationPath: '/hmc',
        environment: 'Development',
        applicationVersion: 'v1.0',
        loginRoute: '/login',
        usersRoute: '/hmc/users',
        servicesRoute: '/hmc/services',
      });
      await loadClients();
    } catch (err: any) {
      setActionMessage(`Error creating client: ${err.message}`);
    }
  };

  const handleUpdateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient) return;
    try {
      await ApiClient.request(`/clients/${selectedClient.id}`, {
        method: 'PUT',
        body: JSON.stringify(clientForm),
      });
      setIsEditModalOpen(false);
      await loadClients();
    } catch (err: any) {
      setActionMessage(`Error updating client: ${err.message}`);
    }
  };

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient) return;
    try {
      await ApiClient.request(`/clients/${selectedClient.id}/credentials`, {
        method: 'POST',
        body: JSON.stringify({
          clientId: selectedClient.id,
          ...credForm,
        }),
      });
      setIsCredModalOpen(false);
      setCredForm({ credentialName: 'Default HMC Operator', username: '', password: '' });
      await loadClients();
    } catch (err: any) {
      setActionMessage(`Error saving credentials: ${err.message}`);
    }
  };

  const handleTestConnection = async (client: ClientWithCredentialInfo) => {
    setTestingId(client.id);
    try {
      const res = await ApiClient.request<{ success: boolean; status: string; latencyMs: number }>(
        `/clients/${client.id}/test-connection`,
        { method: 'POST' }
      );
      if (res.success) {
        setActionMessage(`✓ Connection test passed for ${client.clientCode} (${res.latencyMs}ms).`);
      } else {
        setActionMessage(`✗ Connection test failed for ${client.clientCode}. Server responded with status: ${res.status}`);
      }
      await loadClients();
    } catch (err: any) {
      setActionMessage(`✗ Connection failed: ${err.message}`);
    } finally {
      setTestingId(null);
      setTimeout(() => setActionMessage(null), 5000);
    }
  };

  const handleOpenAndLogin = async (client: ClientWithCredentialInfo) => {
    if (launchingClientIds[client.id]) return; // Single-flight per client

    const displayName = client.clientName || client.clientCode;

    // Immediate button response (<30ms)
    setLaunchingClientIds((prev) => ({ ...prev, [client.id]: true }));

    if (toastDismissTimerRef.current) clearTimeout(toastDismissTimerRef.current);

    // Immediate non-blocking toast (<30ms)
    setToast({
      id: client.id,
      clientId: client.id,
      clientCode: client.clientCode,
      clientName: client.clientName,
      status: 'LAUNCHING',
      message: `Opening ${displayName}…`,
      client,
    });

    const pollStartTime = Date.now();
    let pollTimer: NodeJS.Timeout | null = null;

    const clearLaunchState = () => {
      if (pollTimer) clearInterval(pollTimer);
      setLaunchingClientIds((prev) => ({ ...prev, [client.id]: false }));
    };

    try {
      const res = await ApiClient.request<{ id: string; status: string }>('/agents/dispatch-open-and-login', {
        method: 'POST',
        body: JSON.stringify({ clientId: client.id }),
      });

      // Poll run status non-blockingly (250ms intervals) with 30s bounded timeout
      pollTimer = setInterval(async () => {
        try {
          if (Date.now() - pollStartTime > 30000) {
            clearLaunchState();
            setToast({
              id: client.id,
              clientId: client.id,
              clientCode: client.clientCode,
              clientName: client.clientName,
              status: 'ERROR',
              message: `CLIENT_PORTAL_TIMEOUT: Timed out waiting for ${displayName} portal to open and verify.`,
              client,
            });
            return;
          }

          const run = await ApiClient.request<any>(`/agents/runs/${res.id}`);
          if (!run) return;

          if (run.status === 'COMPLETED' || run.status === 'SUCCEEDED') {
            clearLaunchState();
            setToast({
              id: client.id,
              clientId: client.id,
              clientCode: client.clientCode,
              clientName: client.clientName,
              status: 'SUCCESS',
              message: `${displayName} opened and ready.`,
              client,
            });
            toastDismissTimerRef.current = setTimeout(() => {
              setToast((curr) => (curr?.id === client.id && curr?.status === 'SUCCESS' ? null : curr));
            }, 3000);
          } else if (run.status === 'REQUIRES_MANUAL_INTERVENTION') {
            clearLaunchState();
            setToast({
              id: client.id,
              clientId: client.id,
              clientCode: client.clientCode,
              clientName: client.clientName,
              status: 'REQUIRES_INTERVENTION',
              message: 'Manual security verification is required in the opened browser window.',
              client,
            });
          } else if (run.status === 'FAILED') {
            clearLaunchState();
            setToast({
              id: client.id,
              clientId: client.id,
              clientCode: client.clientCode,
              clientName: client.clientName,
              status: 'ERROR',
              message: run.errorMessage || `CLIENT_AUTO_LOGIN_FAILED: Failed to open ${displayName}.`,
              client,
            });
          }
        } catch {
          // Keep polling quietly
        }
      }, 250);
    } catch (err: any) {
      clearLaunchState();
      let msg = err.message || `CLIENT_AUTO_LOGIN_FAILED: Failed to open ${displayName}.`;
      if (msg.includes('DESKTOP_AGENT_OFFLINE') || msg.includes('Desktop browser agent is not running')) {
        msg = 'DESKTOP_AGENT_OFFLINE: Desktop browser agent is offline. Start the agent.';
      } else if (msg.includes('CLIENT_URL_INVALID')) {
        msg = 'CLIENT_URL_INVALID: Client base URL is not configured or invalid.';
      } else if (msg.includes('CLIENT_AUTO_LOGIN_FAILED') || msg.includes('Saved login credentials are unavailable')) {
        msg = 'CLIENT_AUTO_LOGIN_FAILED: Saved login credentials are unavailable for this client. Configure credentials in vault.';
      }

      setToast({
        id: client.id,
        clientId: client.id,
        clientCode: client.clientCode,
        clientName: client.clientName,
        status: 'ERROR',
        message: msg,
        client,
      });
    }
  };

  const filteredClients = clients.filter((c) => {
    const term = search.trim().toLowerCase();

    const matchesSearch =
      !term ||
      Boolean(c.clientCode && c.clientCode.toLowerCase().includes(term)) ||
      Boolean(c.clientName && c.clientName.toLowerCase().includes(term)) ||
      Boolean(c.baseUrl && c.baseUrl.toLowerCase().includes(term)) ||
      Boolean(c.environment && c.environment.toLowerCase().includes(term)) ||
      Boolean(c.applicationVersion && c.applicationVersion.toLowerCase().includes(term));

    const matchesEnv = selectedEnv === 'ALL' || c.environment.toLowerCase() === selectedEnv.toLowerCase();
    return matchesSearch && matchesEnv;
  });

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Client Application Instances</h1>
          <p className="text-sm text-slate-400 mt-1">
            Registered hospital management central application endpoints and managed sessions
          </p>
        </div>

        {hasPermission(PERMISSIONS.CLIENT_CREATE) && (
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium shadow-lg shadow-sky-950/50 transition-all self-start"
          >
            <Plus className="w-4 h-4" />
            Register Client Instance
          </button>
        )}
      </div>

      {actionMessage && (
        <div className="p-3 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-300">
          {actionMessage}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-4 bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search by client code, hospital name, environment, base URL, or version..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-10 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-2.5 text-slate-400 hover:text-white p-0.5 rounded-full hover:bg-slate-800 transition-colors"
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          {['ALL', 'Development', 'Test', 'Staging', 'Local', 'Production'].map((env) => (
            <button
              key={env}
              onClick={() => setSelectedEnv(env)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                selectedEnv === env
                  ? 'bg-sky-600/20 border border-sky-500 text-sky-400'
                  : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {env}
            </button>
          ))}
        </div>
      </div>

      {/* Client List Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-950 text-slate-400 text-xs uppercase font-semibold border-b border-slate-800">
            <tr>
              <th className="px-6 py-3.5">Client Code</th>
              <th className="px-6 py-3.5">Name / Endpoint</th>
              <th className="px-6 py-3.5">Environment</th>
              <th className="px-6 py-3.5">Credentials Status</th>
              <th className="px-6 py-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-sky-500" />
                  Loading client endpoints...
                </td>
              </tr>
            ) : filteredClients.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                  <div className="max-w-sm mx-auto space-y-2">
                    <p className="text-slate-400 font-medium">No matching clients found.</p>
                    <p className="text-xs text-slate-600">
                      No client instances matched your search filter criteria.
                    </p>
                    {search && (
                      <button
                        onClick={() => setSearch('')}
                        className="mt-2 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-colors"
                      >
                        Clear Search
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              filteredClients.map((client) => {
                const isProd = client.environment === 'Production';
                const isLaunchingThisClient = Boolean(launchingClientIds[client.id]);

                return (
                  <tr key={client.id} className="hover:bg-slate-850/50 transition-colors">
                    <td className="px-6 py-4 font-mono font-medium text-white">{client.clientCode}</td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-200">{client.clientName}</div>
                      <div className="text-xs text-slate-500 font-mono mt-0.5">{client.baseUrl}</div>
                    </td>
                    <td className="px-6 py-4">
                      <EnvironmentBadge environment={client.environment} />
                    </td>
                    <td className="px-6 py-4">
                      {client.hasCredentials ? (
                        <div className="flex items-center gap-1.5 text-emerald-400 text-xs">
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>Configured {client.credentialSummary?.usernameMasked ? `(${client.credentialSummary.usernameMasked})` : ''}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-amber-400 text-xs">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          <span>No Credentials</span>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* Test Connection Button */}
                        <button
                          onClick={() => handleTestConnection(client)}
                          disabled={testingId === client.id}
                          title="Test endpoint connectivity"
                          className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
                        >
                          <RefreshCw className={`w-4 h-4 ${testingId === client.id ? 'animate-spin' : ''}`} />
                        </button>

                        {/* Credential Vault */}
                        {hasPermission(PERMISSIONS.CREDENTIAL_MANAGE) && (
                          <button
                            onClick={() => {
                              setSelectedClient(client);
                              setIsCredModalOpen(true);
                            }}
                            title="Manage Encrypted Credentials"
                            className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg transition-colors"
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>
                        )}

                        {/* Edit Client */}
                        {hasPermission(PERMISSIONS.CLIENT_UPDATE) && (
                          <button
                            onClick={() => {
                              setSelectedClient(client);
                              setClientForm({
                                clientCode: client.clientCode,
                                clientName: client.clientName,
                                baseUrl: client.baseUrl,
                                applicationPath: client.applicationPath,
                                environment: client.environment,
                                applicationVersion: client.applicationVersion,
                                loginRoute: client.loginRoute,
                                usersRoute: client.usersRoute,
                                servicesRoute: client.servicesRoute,
                              });
                              setIsEditModalOpen(true);
                            }}
                            title="Edit Configuration"
                            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}

                        {/* Open & Login Button */}
                        {hasPermission(PERMISSIONS.CLIENT_OPEN) && (
                          <button
                            onClick={() => handleOpenAndLogin(client)}
                            disabled={isLaunchingThisClient}
                            title="Launch auto-login browser session"
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow transition-all disabled:opacity-50 ${
                              isProd
                                ? 'bg-red-900 hover:bg-red-800 text-red-100 border border-red-700 shadow-red-950/50'
                                : 'bg-sky-600 hover:bg-sky-500 text-white shadow-sky-950/50'
                            }`}
                          >
                            {isLaunchingThisClient ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Play className="w-3.5 h-3.5 fill-current" />
                            )}
                            Open & Login
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Non-Blocking Floating Status Toast */}
      {toast && (
        <div
          data-testid="launch-toast"
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border transition-all animate-in fade-in slide-in-from-bottom-3 duration-200 ${
            toast.status === 'LAUNCHING'
              ? 'bg-slate-900/95 border-sky-500/60 text-sky-200 shadow-sky-950/40 backdrop-blur-md'
              : toast.status === 'SUCCESS'
              ? 'bg-slate-900/95 border-emerald-500/60 text-emerald-200 shadow-emerald-950/40 backdrop-blur-md'
              : toast.status === 'REQUIRES_INTERVENTION'
              ? 'bg-slate-900/95 border-amber-500/60 text-amber-200 shadow-amber-950/40 backdrop-blur-md'
              : 'bg-slate-900/95 border-red-500/60 text-red-200 shadow-red-950/40 backdrop-blur-md'
          }`}
        >
          {toast.status === 'LAUNCHING' && (
            <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
          )}
          {toast.status === 'SUCCESS' && (
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          {toast.status === 'REQUIRES_INTERVENTION' && (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          )}
          {toast.status === 'ERROR' && (
            <XCircle className="w-4 h-4 text-red-400 shrink-0" />
          )}

          <div className="text-xs font-medium pr-1">{toast.message}</div>

          {toast.status === 'ERROR' && (
            <button
              onClick={() => handleOpenAndLogin(toast.client)}
              className="ml-2 px-2.5 py-1 bg-red-800/80 hover:bg-red-700 text-white rounded-lg text-xs font-semibold transition-colors"
            >
              Retry
            </button>
          )}

          {(toast.status === 'ERROR' || toast.status === 'REQUIRES_INTERVENTION') && (
            <button
              onClick={() => setToast(null)}
              className="text-slate-400 hover:text-white text-xs font-bold p-1 rounded transition-colors"
              title="Dismiss"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* Modal: Register Client */}
      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="Register Client Instance">
        <form onSubmit={handleCreateClient} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Client Code (Unique ID)</label>
            <input
              type="text"
              required
              placeholder="e.g. CLINIC-ALPHA"
              value={clientForm.clientCode}
              onChange={(e) => setClientForm({ ...clientForm, clientCode: e.target.value.toUpperCase() })}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Client / Hospital Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Alpha Hospital & Research Center"
              value={clientForm.clientName}
              onChange={(e) => setClientForm({ ...clientForm, clientName: e.target.value })}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Base URL</label>
            <input
              type="url"
              required
              placeholder="https://alpha.hospital.local"
              value={clientForm.baseUrl}
              onChange={(e) => setClientForm({ ...clientForm, baseUrl: e.target.value })}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-sky-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Environment Classification</label>
            <select
              value={clientForm.environment}
              onChange={(e) => setClientForm({ ...clientForm, environment: e.target.value as ClientEnvironment })}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-sky-500"
            >
              <option value="Development">Development (Local dev environment)</option>
              <option value="Local">Local (Local machine deployment)</option>
              <option value="Test">Test (Automated QA environment)</option>
              <option value="Staging">Staging (Pre-production staging)</option>
              <option value="Production">Production (Live Clinical Systems - RESTRICTED)</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(false)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-medium shadow-lg shadow-sky-950/50"
            >
              Register Endpoint
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Edit Client */}
      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="Edit Client Configuration">
        <form onSubmit={handleUpdateClient} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Client Code</label>
            <input
              type="text"
              disabled
              value={clientForm.clientCode}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-500 cursor-not-allowed font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Client / Hospital Name</label>
            <input
              type="text"
              required
              value={clientForm.clientName}
              onChange={(e) => setClientForm({ ...clientForm, clientName: e.target.value })}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Base URL</label>
            <input
              type="url"
              required
              value={clientForm.baseUrl}
              onChange={(e) => setClientForm({ ...clientForm, baseUrl: e.target.value })}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-sky-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Environment Classification</label>
            <select
              value={clientForm.environment}
              onChange={(e) => setClientForm({ ...clientForm, environment: e.target.value as ClientEnvironment })}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-sky-500"
            >
              <option value="Development">Development (Local dev environment)</option>
              <option value="Local">Local (Local machine deployment)</option>
              <option value="Test">Test (Automated QA environment)</option>
              <option value="Staging">Staging (Pre-production staging)</option>
              <option value="Production">Production (Live Clinical Systems - RESTRICTED)</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setIsEditModalOpen(false)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-medium"
            >
              Save Configuration
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Manage Encrypted Credentials */}
      <Modal
        isOpen={isCredModalOpen}
        onClose={() => setIsCredModalOpen(false)}
        title={`Encrypted Credential Vault: ${selectedClient?.clientCode}`}
      >
        <form onSubmit={handleSaveCredentials} className="space-y-4">
          <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
            <div className="text-xs text-slate-400 mb-1">Security Architecture Notice</div>
            <div className="text-xs text-slate-500">
              Credentials are encrypted client-side via AES-256-GCM Envelope Encryption before storage in MSSQL.
              Only authorized Automation Agents can decrypt them for browser session initialization.
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Username</label>
            <input
              type="text"
              required
              placeholder="Operator / Admin Username"
              value={credForm.username}
              onChange={(e) => setCredForm({ ...credForm, username: e.target.value })}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Password</label>
            <input
              type="password"
              required
              placeholder="Operator Password"
              value={credForm.password}
              onChange={(e) => setCredForm({ ...credForm, password: e.target.value })}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-sky-500 font-mono"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setIsCredModalOpen(false)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-medium shadow-lg shadow-amber-950/50"
            >
              Encrypt & Store Credential
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
