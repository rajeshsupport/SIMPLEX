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

interface StepStatusItem {
  id: string;
  label: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
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
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientWithCredentialInfo | null>(null);

  // Form states
  const [clientForm, setClientForm] = useState({
    clientCode: '',
    clientName: '',
    baseUrl: '',
    applicationPath: '/hmc',
    environment: 'Development' as ClientEnvironment,
    applicationVersion: 'v1.0',
    loginRoute: '/hmc/login',
    usersRoute: '/hmc/users',
    servicesRoute: '/hmc/services',
  });

  const [credForm, setCredForm] = useState({
    credentialName: 'Default HMC Operator',
    username: '',
    password: '',
  });

  // Launch Status states
  const [launchRunId, setLaunchRunId] = useState<string | null>(null);
  const [launchStatus, setLaunchStatus] = useState<'IDLE' | 'STARTING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'REQUIRES_MANUAL_INTERVENTION'>('IDLE');
  const [launchErrorMessage, setLaunchErrorMessage] = useState<string | null>(null);
  const [activeStepText, setActiveStepText] = useState<string>('Starting isolated browser…');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [launchingClientId, setLaunchingClientId] = useState<string | null>(null);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
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
        loginRoute: '/hmc/login',
        usersRoute: '/hmc/users',
        servicesRoute: '/hmc/services',
      });
      await loadClients();
    } catch (err: any) {
      alert(`Error creating client: ${err.message}`);
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
      alert(`Error updating client: ${err.message}`);
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
      alert(`Error saving credentials: ${err.message}`);
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

  const startPollingRun = (runId: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    pollingRef.current = setInterval(async () => {
      try {
        const run = await ApiClient.request<any>(`/agents/runs/${runId}`);
        if (!run) return;

        setLaunchStatus(run.status);

        if (run.steps && run.steps.length > 0) {
          const latestStep = run.steps[run.steps.length - 1];
          setActiveStepText(latestStep.stepName || 'Processing step…');
        }

        if (run.status === 'COMPLETED') {
          setActiveStepText('Login successful — browser ready.');
          setLaunchErrorMessage(null);
          if (pollingRef.current) clearInterval(pollingRef.current);
        } else if (run.status === 'FAILED') {
          setLaunchErrorMessage(run.errorMessage || 'Client login failed.');
          if (pollingRef.current) clearInterval(pollingRef.current);
        } else if (run.status === 'REQUIRES_MANUAL_INTERVENTION') {
          setActiveStepText('Manual security verification is required in the opened browser window.');
          setLaunchErrorMessage(null);
          if (pollingRef.current) clearInterval(pollingRef.current);
        }
      } catch (err: any) {
        console.warn('Polling error:', err);
      }
    }, 600);
  };

  const handleOpenAndLogin = async (client: ClientWithCredentialInfo) => {
    if (launchingClientId) return; // Prevent double click

    setSelectedClient(client);
    setLaunchingClientId(client.id);
    setIsStatusModalOpen(true);
    setLaunchStatus('STARTING');
    setLaunchErrorMessage(null);
    setActiveStepText('Starting isolated browser…');

    try {
      const res = await ApiClient.request<{ id: string; status: string }>('/agents/dispatch-open-and-login', {
        method: 'POST',
        body: JSON.stringify({ clientId: client.id }),
      });

      setLaunchRunId(res.id);
      setLaunchStatus('RUNNING');
      setActiveStepText('Opening client URL…');
      startPollingRun(res.id);
    } catch (err: any) {
      setLaunchStatus('FAILED');
      const msg = err.message && err.message.includes('agent')
        ? 'Desktop browser agent is not running. Start the agent and try again.'
        : err.message || 'Failed to dispatch launch';
      setLaunchErrorMessage(msg);
    } finally {
      setLaunchingClientId(null);
    }
  };

  const handleCancelLaunch = async () => {
    if (launchRunId) {
      try {
        await ApiClient.request(`/agents/runs/${launchRunId}/cancel`, { method: 'POST' });
      } catch {}
    }
    if (pollingRef.current) clearInterval(pollingRef.current);
    setIsStatusModalOpen(false);
    setLaunchStatus('IDLE');
    setLaunchRunId(null);
  };

  const filteredClients = clients.filter((c) => {
    const matchesSearch =
      c.clientCode.toLowerCase().includes(search.toLowerCase()) ||
      c.clientName.toLowerCase().includes(search.toLowerCase()) ||
      c.baseUrl.toLowerCase().includes(search.toLowerCase());
    const matchesEnv = selectedEnv === 'ALL' || c.environment === selectedEnv;
    return matchesSearch && matchesEnv;
  });

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">HMC Client Configurations</h2>
          <p className="text-xs text-slate-400">Database-driven client application profiles and credential vault</p>
        </div>

        {hasPermission(PERMISSIONS.CLIENT_CREATE) && (
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-semibold shadow-lg shadow-sky-900/30 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add New Client
          </button>
        )}
      </div>

      {actionMessage && (
        <div className="p-3.5 bg-sky-950/80 border border-sky-800 text-sky-200 text-xs rounded-lg animate-in fade-in">
          {actionMessage}
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3 bg-surface p-3.5 rounded-xl border border-surface-border">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by client code, name, or base URL..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 bg-slate-900 border border-slate-700/80 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          {['ALL', 'Production', 'Staging', 'UAT', 'Test', 'Development', 'Local'].map((env) => (
            <button
              key={env}
              onClick={() => setSelectedEnv(env)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                selectedEnv === env
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {env}
            </button>
          ))}
        </div>
      </div>

      {/* Clients Table */}
      <div className="bg-surface border border-surface-border rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-900/80 border-b border-surface-border text-slate-400 uppercase tracking-wider font-semibold">
              <th className="py-3 px-4">Client Code & Name</th>
              <th className="py-3 px-4">Environment</th>
              <th className="py-3 px-4">Base URL & Routes</th>
              <th className="py-3 px-4">Credentials Status</th>
              <th className="py-3 px-4">Connection</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-500">Loading clients...</td>
              </tr>
            ) : filteredClients.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-500">No matching clients found.</td>
              </tr>
            ) : (
              filteredClients.map((client) => {
                const isProd = client.environment === 'Production';
                const isLaunching = launchingClientId === client.id;

                return (
                  <tr key={client.id} className={`hover:bg-slate-900/40 transition-colors ${isProd ? 'bg-red-950/10' : ''}`}>
                    <td className="py-3.5 px-4">
                      <div className="font-mono font-bold text-sky-400 text-sm">{client.clientCode}</div>
                      <div className="text-slate-300 font-medium">{client.clientName}</div>
                    </td>

                    <td className="py-3.5 px-4">
                      <EnvironmentBadge environment={client.environment} />
                    </td>

                    <td className="py-3.5 px-4 font-mono text-[11px] text-slate-400">
                      <div>{client.baseUrl}</div>
                      <div className="text-slate-500">{client.loginRoute}</div>
                    </td>

                    <td className="py-3.5 px-4">
                      {client.hasCredentials && client.credentialSummary ? (
                        <div className="flex items-center gap-1.5 text-emerald-400">
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span className="font-mono">{client.credentialSummary.usernameMasked}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-amber-400">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Not Configured</span>
                        </div>
                      )}
                    </td>

                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-block w-2.5 h-2.5 rounded-full ${
                          client.connectionStatus === 'CONNECTED'
                            ? 'bg-emerald-500'
                            : client.connectionStatus === 'ERROR'
                            ? 'bg-red-500'
                            : 'bg-slate-600'
                        }`}
                        title={client.connectionStatus}
                      />
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Connection Test */}
                        <button
                          onClick={() => handleTestConnection(client)}
                          disabled={testingId === client.id}
                          title="Test Connection"
                          className="p-1.5 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded-lg transition-colors"
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
                            disabled={isLaunching || !client.hasCredentials}
                            title={!client.hasCredentials ? 'Configure credentials first' : 'Launch auto-login browser session'}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow transition-all disabled:opacity-50 ${
                              isProd
                                ? 'bg-red-900 hover:bg-red-800 text-red-100 border border-red-700 shadow-red-950/50'
                                : 'bg-sky-600 hover:bg-sky-500 text-white shadow-sky-950/50'
                            }`}
                          >
                            {isLaunching ? (
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

      {/* Launch Live Status Modal */}
      <Modal
        isOpen={isStatusModalOpen}
        onClose={() => {
          if (launchStatus === 'STARTING' || launchStatus === 'RUNNING') {
            handleCancelLaunch();
          } else {
            setIsStatusModalOpen(false);
          }
        }}
        title={`Opening Client: ${selectedClient?.clientName || selectedClient?.clientCode}`}
      >
        <div className="space-y-4 py-2">
          {/* Progress Banner */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              {launchStatus === 'STARTING' || launchStatus === 'RUNNING' ? (
                <div className="w-8 h-8 rounded-full bg-sky-900/60 border border-sky-500 flex items-center justify-center">
                  <Loader2 className="w-4 h-4 text-sky-400 animate-spin" />
                </div>
              ) : launchStatus === 'COMPLETED' ? (
                <div className="w-8 h-8 rounded-full bg-emerald-950 border border-emerald-500 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                </div>
              ) : launchStatus === 'REQUIRES_MANUAL_INTERVENTION' ? (
                <div className="w-8 h-8 rounded-full bg-amber-950 border border-amber-500 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                </div>
              ) : (
                <div className="w-8 h-8 rounded-full bg-red-950 border border-red-500 flex items-center justify-center">
                  <XCircle className="w-5 h-5 text-red-400" />
                </div>
              )}

              <div>
                <div className="text-sm font-semibold text-white">{activeStepText}</div>
                <div className="text-xs text-slate-400 font-mono mt-0.5">
                  Profile: ~/.hmc-console/profiles/client_{selectedClient?.clientCode || 'default'}
                </div>
              </div>
            </div>

            {/* Error or Warning Display */}
            {launchErrorMessage && (
              <div className="p-3 bg-red-950/60 border border-red-800 rounded-lg text-red-300 text-xs flex items-start gap-2">
                <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div>{launchErrorMessage}</div>
              </div>
            )}

            {launchStatus === 'REQUIRES_MANUAL_INTERVENTION' && (
              <div className="p-3 bg-amber-950/60 border border-amber-800 rounded-lg text-amber-300 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <strong>Security Checkpoint:</strong> Manual security verification (MFA/OTP/CAPTCHA) is required in the opened browser window. Complete verification in the window to continue.
                </div>
              </div>
            )}

            {launchStatus === 'COMPLETED' && (
              <div className="p-3 bg-emerald-950/60 border border-emerald-800 rounded-lg text-emerald-300 text-xs flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  Browser is open and authenticated. You can now use the separate browser window to perform clinical operations.
                </div>
              </div>
            )}
          </div>

          {/* Modal Action Buttons */}
          <div className="flex justify-end gap-3 pt-2">
            {launchStatus === 'STARTING' || launchStatus === 'RUNNING' ? (
              <button
                onClick={handleCancelLaunch}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium"
              >
                Cancel Launch
              </button>
            ) : launchStatus === 'FAILED' ? (
              <>
                <button
                  onClick={() => setIsStatusModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium"
                >
                  Close
                </button>
                {selectedClient && (
                  <button
                    onClick={() => handleOpenAndLogin(selectedClient)}
                    className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold"
                  >
                    Retry Launch
                  </button>
                )}
              </>
            ) : (
              <button
                onClick={() => setIsStatusModalOpen(false)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold"
              >
                Close Status (Keep Browser Open)
              </button>
            )}
          </div>
        </div>
      </Modal>

      {/* Create / Edit Client Modal */}
      <Modal
        isOpen={isCreateModalOpen || isEditModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          setIsEditModalOpen(false);
        }}
        title={isCreateModalOpen ? 'Create New HMC Client' : `Edit Client: ${selectedClient?.clientCode}`}
      >
        <form onSubmit={isCreateModalOpen ? handleCreateClient : handleUpdateClient} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Client Code</label>
              <input
                type="text"
                required
                value={clientForm.clientCode}
                onChange={(e) => setClientForm({ ...clientForm, clientCode: e.target.value.toUpperCase() })}
                placeholder="e.g. HMC_NORTH"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Environment</label>
              <select
                value={clientForm.environment}
                onChange={(e) => setClientForm({ ...clientForm, environment: e.target.value as ClientEnvironment })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
              >
                <option value="Development">Development</option>
                <option value="Local">Local</option>
                <option value="Test">Test</option>
                <option value="UAT">UAT</option>
                <option value="Staging">Staging</option>
                <option value="Production">Production (Live)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Client Name</label>
            <input
              type="text"
              required
              value={clientForm.clientName}
              onChange={(e) => setClientForm({ ...clientForm, clientName: e.target.value })}
              placeholder="e.g. North Regional Hospital Center"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Base URL</label>
            <input
              type="url"
              required
              value={clientForm.baseUrl}
              onChange={(e) => setClientForm({ ...clientForm, baseUrl: e.target.value })}
              placeholder="http://localhost:4000 or https://client-portal.example.com"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-white"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Login Route</label>
              <input
                type="text"
                value={clientForm.loginRoute}
                onChange={(e) => setClientForm({ ...clientForm, loginRoute: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Users Route</label>
              <input
                type="text"
                value={clientForm.usersRoute}
                onChange={(e) => setClientForm({ ...clientForm, usersRoute: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Services Route</label>
              <input
                type="text"
                value={clientForm.servicesRoute}
                onChange={(e) => setClientForm({ ...clientForm, servicesRoute: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-white"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-surface-border">
            <button
              type="button"
              onClick={() => {
                setIsCreateModalOpen(false);
                setIsEditModalOpen(false);
              }}
              className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-xs hover:bg-slate-700"
            >
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 bg-sky-600 text-white rounded-lg text-xs font-semibold hover:bg-sky-500">
              Save Client Configuration
            </button>
          </div>
        </form>
      </Modal>

      {/* Credentials Modal */}
      <Modal
        isOpen={isCredModalOpen}
        onClose={() => setIsCredModalOpen(false)}
        title={`Encrypted Credentials: ${selectedClient?.clientCode}`}
      >
        <form onSubmit={handleSaveCredentials} className="space-y-4">
          <div className="p-3 bg-amber-950/40 border border-amber-800/80 rounded-lg text-amber-300 text-xs">
            Credentials will be stored using AES-256-GCM envelope encryption. Plaintext is never exposed in logs or API responses.
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Credential Name / Label</label>
            <input
              type="text"
              required
              value={credForm.credentialName}
              onChange={(e) => setCredForm({ ...credForm, credentialName: e.target.value })}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Operator Username / Login</label>
            <input
              type="text"
              required
              value={credForm.username}
              onChange={(e) => setCredForm({ ...credForm, username: e.target.value })}
              placeholder="e.g. hmc_operator"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Operator Password</label>
            <input
              type="password"
              required
              value={credForm.password}
              onChange={(e) => setCredForm({ ...credForm, password: e.target.value })}
              placeholder="••••••••••••"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-surface-border">
            <button
              type="button"
              onClick={() => setIsCredModalOpen(false)}
              className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-xs hover:bg-slate-700"
            >
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-500">
              Encrypt & Store Credentials
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
