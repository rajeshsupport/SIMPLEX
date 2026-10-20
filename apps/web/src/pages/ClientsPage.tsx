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
  GitBranch,
  ExternalLink,
  Layers,
  Clock,
} from 'lucide-react';
import { ApiClient } from '../api/client.js';
import { EnvironmentBadge } from '../components/EnvironmentBadge.js';
import { Modal } from '../components/Modal.js';
import { ClientWithCredentialInfo, ClientEnvironment, PERMISSIONS, MultiTabTargetItem, TabItemStatus } from '@hmc/shared';
import { useAuth } from '../context/AuthContext.js';

interface SelectedTabTarget {
  clientId: string;
  clientCode: string;
  clientName: string;
  baseUrl: string;
  screenName: string;
  targetRoute: string;
  targetBranch?: string;
}

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
    applicationPath: '',
    environment: 'Development' as ClientEnvironment,
    applicationVersion: 'v1.0',
    loginRoute: '/login',
    usersRoute: '/users',
    servicesRoute: '/services',
    branchName: '',
    branchesInput: '',
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
  const [createError, setCreateError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [isBranchLaunchModalOpen, setIsBranchLaunchModalOpen] = useState(false);
  const [clientForBranchLaunch, setClientForBranchLaunch] = useState<ClientWithCredentialInfo | null>(null);
  const [selectedLaunchBranch, setSelectedLaunchBranch] = useState<string>('');
  const [customLaunchBranch, setCustomLaunchBranch] = useState<string>('');

  // Multiple tabs states
  const [selectedTargets, setSelectedTargets] = useState<SelectedTabTarget[]>([]);
  const [isLaunchingMultiTabs, setIsLaunchingMultiTabs] = useState(false);
  const [multiTabModalOpen, setMultiTabModalOpen] = useState(false);
  const [multiTabItems, setMultiTabItems] = useState<MultiTabTargetItem[]>([]);
  const [multiTabSummary, setMultiTabSummary] = useState<string | null>(null);
  const isLaunchingMultiTabsRef = useRef(false);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const toastDismissTimerRef = useRef<NodeJS.Timeout | null>(null);
  const { hasPermission } = useAuth();

  const loadClients = async () => {
    try {
      setLoading(true);
      const data = await ApiClient.request<ClientWithCredentialInfo[]>('/clients');
      setClients(data || []);
    } catch (err: any) {
      setActionMessage(`Error loading clients: ${err.message}`);
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
    setCreateError(null);
    try {
      const isSimplex = clientForm.baseUrl.toLowerCase().includes('simplex');
      const parsedBranches = clientForm.branchesInput
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const chosenBranch = clientForm.branchName?.trim() || (parsedBranches.length > 0 ? parsedBranches[0] : null);

      const payload = {
        ...clientForm,
        applicationPath: isSimplex ? '' : (clientForm.applicationPath || ''),
        usersRoute: isSimplex ? '/users' : (clientForm.usersRoute || '/users'),
        servicesRoute: isSimplex ? '/services' : (clientForm.servicesRoute || '/services'),
        loginRoute: clientForm.loginRoute || '/login',
        applicationVersion: isSimplex && clientForm.clientCode.includes('9.1') ? 'MasterV9.1' : (clientForm.applicationVersion || 'v1.0'),
        branchName: chosenBranch,
        branches: parsedBranches,
      };
      delete (payload as any).branchesInput;

      await ApiClient.request('/clients', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setIsCreateModalOpen(false);
      setClientForm({
        clientCode: '',
        clientName: '',
        baseUrl: '',
        applicationPath: '',
        environment: 'Development',
        applicationVersion: 'v1.0',
        loginRoute: '/login',
        usersRoute: '/users',
        servicesRoute: '/services',
        branchName: '',
        branchesInput: '',
      });
      await loadClients();
    } catch (err: any) {
      const errDetail = Array.isArray(err.errors) ? err.errors.join(', ') : (err.message || 'Validation failed');
      setCreateError(errDetail);
      setActionMessage(`Error creating client: ${errDetail}`);
    }
  };

  const handleUpdateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient) return;
    try {
      const parsedBranches = clientForm.branchesInput
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const chosenBranch = clientForm.branchName?.trim() || (parsedBranches.length > 0 ? parsedBranches[0] : null);

      const payload: any = {
        ...clientForm,
        branchName: chosenBranch,
        branches: parsedBranches,
      };
      delete payload.branchesInput;

      await ApiClient.request(`/clients/${selectedClient.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
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

  const handleOpenAndLogin = async (client: ClientWithCredentialInfo, targetBranch?: string) => {
    if (launchingClientIds[client.id]) return; // Single-flight per client

    const displayName = client.clientName || client.clientCode;
    const branchLabel = targetBranch ? ` [${targetBranch}]` : '';

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
      message: `Opening ${displayName}${branchLabel}…`,
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
        body: JSON.stringify({
          clientId: client.id,
          targetBranch: targetBranch || client.branchName || undefined,
        }),
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
              message: `${displayName}${branchLabel} opened and ready.`,
              client,
            });
            loadClients(); // Reload clients to immediately show newly auto-discovered branches
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

  const toggleScreenSelection = (client: ClientWithCredentialInfo, screenName: string, targetRoute: string) => {
    setSelectedTargets((prev) => {
      const exists = prev.some((t) => t.clientId === client.id && t.targetRoute === targetRoute);
      if (exists) {
        return prev.filter((t) => !(t.clientId === client.id && t.targetRoute === targetRoute));
      } else {
        return [
          ...prev,
          {
            clientId: client.id,
            clientCode: client.clientCode,
            clientName: client.clientName || client.clientCode,
            baseUrl: client.baseUrl,
            screenName,
            targetRoute,
            targetBranch: client.branchName || (client.branches && client.branches[0]) || undefined,
          },
        ];
      }
    });
  };

  const toggleClientSelection = (client: ClientWithCredentialInfo) => {
    setSelectedTargets((prev) => {
      const hasAny = prev.some((t) => t.clientId === client.id);
      if (hasAny) {
        return prev.filter((t) => t.clientId !== client.id);
      } else {
        return [
          ...prev,
          {
            clientId: client.id,
            clientCode: client.clientCode,
            clientName: client.clientName || client.clientCode,
            baseUrl: client.baseUrl,
            screenName: 'Dashboard',
            targetRoute: '/hmc/dashboard',
            targetBranch: client.branchName || (client.branches && client.branches[0]) || undefined,
          },
        ];
      }
    });
  };

  const handleOpenMultipleTabs = async () => {
    // Guard against double clicks or insufficient selections (Requirements 11 & 15)
    if (isLaunchingMultiTabsRef.current || selectedTargets.length < 2) return;
    isLaunchingMultiTabsRef.current = true;
    setIsLaunchingMultiTabs(true);

    const initialItems: MultiTabTargetItem[] = selectedTargets.map((target, idx) => ({
      id: `${target.clientId}_${target.screenName}_${idx}`,
      clientId: target.clientId,
      clientCode: target.clientCode,
      clientName: target.clientName,
      baseUrl: target.baseUrl,
      targetRoute: target.targetRoute,
      screenName: target.screenName,
      targetBranch: target.targetBranch,
      status: 'QUEUED',
    }));

    setMultiTabItems(initialItems);
    setMultiTabModalOpen(true);
    setMultiTabSummary('Dispatching single browser-agent task for multi-tab session…');

    let pollTimer: NodeJS.Timeout | null = null;
    const pollStartTime = Date.now();

    const cleanup = () => {
      if (pollTimer) clearInterval(pollTimer);
      isLaunchingMultiTabsRef.current = false;
      setIsLaunchingMultiTabs(false);
    };

    try {
      const res = await ApiClient.request<{ id: string; status: string }>('/agents/dispatch-multiple-tabs', {
        method: 'POST',
        body: JSON.stringify({
          items: selectedTargets.map((t) => ({
            clientId: t.clientId,
            targetBranch: t.targetBranch,
            targetRoute: t.targetRoute,
            screenName: t.screenName,
          })),
        }),
      });

      setMultiTabSummary('Google Chrome Guest session launched. Initializing tabs…');

      pollTimer = setInterval(async () => {
        try {
          if (Date.now() - pollStartTime > 45000) {
            cleanup();
            setMultiTabSummary('Operation timed out waiting for tabs.');
            setMultiTabItems((curr) =>
              curr.map((item) =>
                item.status === 'READY' || item.status === 'NAVIGATION_SUCCESS'
                  ? item
                  : { ...item, status: 'FAILED', errorMessage: 'CLIENT_PORTAL_TIMEOUT: Timed out waiting for tab' }
              )
            );
            return;
          }

          const run = await ApiClient.request<any>(`/agents/runs/${res.id}`);
          if (!run) return;

          let updatedTabsList: MultiTabTargetItem[] | null = null;
          if (run.resultSummaryJson) {
            try {
              const resData = JSON.parse(run.resultSummaryJson);
              if (resData.tabs && Array.isArray(resData.tabs)) {
                updatedTabsList = resData.tabs;
              } else if (resData.currentTabUpdate) {
                setMultiTabItems((curr) =>
                  curr.map((item, idx) => (idx === resData.currentIndex ? { ...item, ...resData.currentTabUpdate } : item))
                );
              }
            } catch {}
          }

          if (updatedTabsList) {
            setMultiTabItems(updatedTabsList);
          }

          if (run.status === 'COMPLETED' || run.status === 'SUCCEEDED') {
            cleanup();
            setMultiTabSummary('All selected client screens opened successfully in separate tabs.');
            loadClients();
          } else if (run.status === 'FAILED') {
            cleanup();
            setMultiTabSummary(run.errorMessage || 'One or more tabs failed to open.');
          }
        } catch {}
      }, 300);
    } catch (err: any) {
      cleanup();
      const errMsg = err.message || 'Failed to dispatch multiple tabs session.';
      setMultiTabSummary(`Launch failed: ${errMsg}`);
      setMultiTabItems((curr) => curr.map((it) => ({ ...it, status: 'FAILED', errorMessage: errMsg })));
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

        <div className="flex items-center gap-3">
          {hasPermission(PERMISSIONS.CLIENT_OPEN) && (
            <button
              onClick={handleOpenMultipleTabs}
              disabled={selectedTargets.length < 2 || isLaunchingMultiTabs}
              title={
                selectedTargets.length < 2
                  ? 'Select at least 2 items to open multiple tabs'
                  : 'Open selected clients and screens in separate browser tabs'
              }
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold shadow-lg transition-all ${
                selectedTargets.length >= 2 && !isLaunchingMultiTabs
                  ? 'bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white shadow-sky-950/50 cursor-pointer'
                  : 'bg-slate-800 text-slate-500 border border-slate-700/50 cursor-not-allowed'
              }`}
            >
              {isLaunchingMultiTabs ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Layers className="w-4 h-4" />
              )}
              Open Multiple Tabs
              {selectedTargets.length > 0 && (
                <span
                  className={`px-1.5 py-0.5 text-[11px] rounded-full font-bold ${
                    selectedTargets.length >= 2 ? 'bg-sky-400 text-slate-950' : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  {selectedTargets.length}
                </span>
              )}
            </button>
          )}

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
              <th className="w-10 px-4 py-3.5 text-center">
                <input
                  type="checkbox"
                  checked={
                    filteredClients.length > 0 &&
                    filteredClients.every((c) => selectedTargets.some((t) => t.clientId === c.id))
                  }
                  onChange={(e) => {
                    if (e.target.checked) {
                      const newTargets: SelectedTabTarget[] = [];
                      filteredClients.forEach((c) => {
                        newTargets.push({
                          clientId: c.id,
                          clientCode: c.clientCode,
                          clientName: c.clientName || c.clientCode,
                          baseUrl: c.baseUrl,
                          screenName: 'Dashboard',
                          targetRoute: '/hmc/dashboard',
                          targetBranch: c.branchName || (c.branches && c.branches[0]) || undefined,
                        });
                      });
                      setSelectedTargets(newTargets);
                    } else {
                      setSelectedTargets([]);
                    }
                  }}
                  className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500 cursor-pointer"
                  title="Select all clients"
                />
              </th>
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
                <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-sky-500" />
                  Loading client endpoints...
                </td>
              </tr>
            ) : filteredClients.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
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
                    <td className="w-10 px-4 py-4 text-center">
                      <input
                        type="checkbox"
                        checked={selectedTargets.some((t) => t.clientId === client.id)}
                        onChange={() => toggleClientSelection(client)}
                        className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500 cursor-pointer"
                        title={`Select ${client.clientCode}`}
                      />
                    </td>
                    <td className="px-6 py-4 font-mono font-medium text-white">
                      <div>{client.clientCode}</div>
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap font-sans">
                        {[
                          { name: 'Dashboard', route: '/hmc/dashboard' },
                          { name: 'Users', route: client.usersRoute || '/users' },
                          { name: 'Services', route: client.servicesRoute || '/services' },
                        ].map((screen) => {
                          const isScreenSelected = selectedTargets.some(
                            (t) => t.clientId === client.id && t.targetRoute === screen.route
                          );
                          return (
                            <button
                              key={screen.name}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleScreenSelection(client, screen.name, screen.route);
                              }}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-all ${
                                isScreenSelected
                                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/60 shadow-sm shadow-sky-500/20'
                                  : 'bg-slate-800/80 text-slate-400 border border-slate-700/60 hover:text-slate-200 hover:border-slate-600'
                              }`}
                              title={`Toggle ${screen.name} tab for ${client.clientCode}`}
                            >
                              {isScreenSelected ? '✓ ' : '+ '}{screen.name}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-200">{client.clientName}</div>
                      <div className="text-xs text-slate-500 font-mono mt-0.5">{client.baseUrl}</div>
                      {client.branchName && (
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
                            Branch: {client.branchName}
                          </span>
                          {client.branches && client.branches.length > 1 && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] text-slate-400 bg-slate-800 border border-slate-700">
                              {client.branches.length} branches
                            </span>
                          )}
                        </div>
                      )}
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
                                branchName: client.branchName || '',
                                branchesInput: (client.branches || []).join(', '),
                              });
                              setIsEditModalOpen(true);
                            }}
                            title="Edit Configuration"
                            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}

                        {/* Open & Login Button Group */}
                        {hasPermission(PERMISSIONS.CLIENT_OPEN) && (
                          <div className="inline-flex items-center rounded-lg shadow">
                            <button
                              onClick={() => {
                                if ((client.branches && client.branches.length > 0) || client.branchName) {
                                  setClientForBranchLaunch(client);
                                  setSelectedLaunchBranch(client.branchName || (client.branches && client.branches[0]) || '');
                                  setCustomLaunchBranch('');
                                  setIsBranchLaunchModalOpen(true);
                                } else {
                                  handleOpenAndLogin(client);
                                }
                              }}
                              disabled={isLaunchingThisClient}
                              title="Launch auto-login browser session"
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-l-lg text-xs font-semibold shadow transition-all disabled:opacity-50 ${
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
                            <button
                              onClick={() => {
                                setClientForBranchLaunch(client);
                                setSelectedLaunchBranch(client.branchName || (client.branches && client.branches[0]) || '');
                                setCustomLaunchBranch('');
                                setIsBranchLaunchModalOpen(true);
                              }}
                              disabled={isLaunchingThisClient}
                              title="Select branch to launch"
                              className={`px-2 py-1.5 rounded-r-lg border-l border-white/20 text-xs font-semibold transition-all disabled:opacity-50 hover:bg-white/10 ${
                                isProd
                                  ? 'bg-red-900 text-red-100'
                                  : 'bg-sky-600 text-white'
                              }`}
                            >
                              <GitBranch className="w-3.5 h-3.5" />
                            </button>
                          </div>
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
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          setCreateError(null);
        }}
        title="Register Client Instance"
      >
        <form onSubmit={handleCreateClient} className="space-y-4">
          {createError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-400 font-mono">
              ✕ {createError}
            </div>
          )}
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

          {/* Multi-Branch Configuration */}
          <div className="pt-3 border-t border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300">
                Multi-Branch Configuration (Optional)
              </label>
              <span className="text-[10px] text-slate-500 font-mono">1 URL with multiple branches</span>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Available Branches (comma or newline separated)
              </label>
              <textarea
                rows={2}
                placeholder="e.g. TESTING GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC, Testing_GAELAN..."
                value={clientForm.branchesInput}
                onChange={(e) => setClientForm({ ...clientForm, branchesInput: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Default Target Branch Dropdown
              </label>
              {clientForm.branchesInput.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).length > 0 ? (
                <select
                  value={clientForm.branchName}
                  onChange={(e) => setClientForm({ ...clientForm, branchName: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-sky-500"
                >
                  <option value="">Auto-select 1st branch on login screen</option>
                  {clientForm.branchesInput
                    .split(/[\n,]+/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="e.g. TESTING GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC"
                  value={clientForm.branchName}
                  onChange={(e) => setClientForm({ ...clientForm, branchName: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-sky-500"
                />
              )}
              <p className="text-[10px] text-slate-500 mt-1">
                Leave empty for direct login (Option 1). Choose/enter branch name if portal prompts 'CHOOSE BRANCH' (Option 2).
              </p>
            </div>
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

          {/* Multi-Branch Configuration */}
          <div className="pt-3 border-t border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300">
                Multi-Branch Configuration (Optional)
              </label>
              <span className="text-[10px] text-slate-500 font-mono">1 URL with multiple branches</span>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Available Branches (comma or newline separated)
              </label>
              <textarea
                rows={2}
                placeholder="e.g. TESTING GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC, Testing_GAELAN..."
                value={clientForm.branchesInput}
                onChange={(e) => setClientForm({ ...clientForm, branchesInput: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Default Target Branch Dropdown
              </label>
              {clientForm.branchesInput.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).length > 0 ? (
                <select
                  value={clientForm.branchName}
                  onChange={(e) => setClientForm({ ...clientForm, branchName: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-sky-500"
                >
                  <option value="">Auto-select 1st branch on login screen</option>
                  {clientForm.branchesInput
                    .split(/[\n,]+/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="e.g. TESTING GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC"
                  value={clientForm.branchName}
                  onChange={(e) => setClientForm({ ...clientForm, branchName: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-sky-500"
                />
              )}
              <p className="text-[10px] text-slate-500 mt-1">
                Leave empty for direct login (Option 1). Choose/enter branch name if portal prompts 'CHOOSE BRANCH' (Option 2).
              </p>
            </div>
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

      {/* Modal: Quick Branch Selection on Login */}
      <Modal
        isOpen={isBranchLaunchModalOpen}
        onClose={() => setIsBranchLaunchModalOpen(false)}
        title={`Select Branch — ${clientForBranchLaunch?.clientName || clientForBranchLaunch?.clientCode}`}
      >
        <div className="space-y-4">
          <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
            <div className="text-xs text-slate-400 font-medium">Target Portal</div>
            <div className="text-xs text-slate-500 font-mono mt-0.5">{clientForBranchLaunch?.baseUrl}</div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Choose Target Branch to Log In:
            </label>
            {clientForBranchLaunch?.branches && clientForBranchLaunch.branches.length > 0 ? (
              <select
                value={selectedLaunchBranch}
                onChange={(e) => setSelectedLaunchBranch(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-sky-500 font-medium"
              >
                {clientForBranchLaunch.branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            ) : (
              <div className="p-3 bg-sky-500/10 border border-sky-500/20 rounded-lg text-xs text-sky-300">
                ℹ No branches saved yet. The agent will automatically scan the portal on login and discover all branches!
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Or specify / type another branch name:
            </label>
            <input
              type="text"
              placeholder="e.g. TESTING GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC"
              value={customLaunchBranch}
              onChange={(e) => setCustomLaunchBranch(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
            />
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={() => {
                if (clientForBranchLaunch) {
                  setIsBranchLaunchModalOpen(false);
                  handleOpenAndLogin(clientForBranchLaunch);
                }
              }}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium"
            >
              Auto-Select 1st Branch
            </button>
            <button
              type="button"
              onClick={() => {
                if (clientForBranchLaunch) {
                  const branchToUse = customLaunchBranch.trim() || selectedLaunchBranch || clientForBranchLaunch.branchName || undefined;
                  setIsBranchLaunchModalOpen(false);
                  handleOpenAndLogin(clientForBranchLaunch, branchToUse);
                }
              }}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-sky-950/50 flex items-center gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Launch & Login to Branch
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: Multiple Tabs Session Progress */}
      <Modal
        isOpen={multiTabModalOpen}
        onClose={() => {
          if (!isLaunchingMultiTabs) {
            setMultiTabModalOpen(false);
          }
        }}
        title={`Multiple Tab Browser Launch ${isLaunchingMultiTabs ? '(Running)' : '(Completed)'}`}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-lg">
            <div className="flex items-center gap-2 text-xs text-slate-300">
              {isLaunchingMultiTabs ? (
                <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
              ) : multiTabItems.every((t) => t.status === 'READY' || t.status === 'NAVIGATION_SUCCESS') ? (
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : multiTabItems.some((t) => t.status === 'READY' || t.status === 'NAVIGATION_SUCCESS') ? (
                <CheckCircle className="w-4 h-4 text-amber-400 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-red-400 shrink-0" />
              )}
              <span className="font-medium">{multiTabSummary}</span>
            </div>
            <span className="text-[11px] font-mono text-slate-400 shrink-0">
              {multiTabItems.filter((t) => t.status === 'READY' || t.status === 'NAVIGATION_SUCCESS').length} / {multiTabItems.length} tabs ready
            </span>
          </div>

          <div className="divide-y divide-slate-800/80 border border-slate-800 rounded-lg overflow-hidden max-h-96 overflow-y-auto">
            {multiTabItems.map((item, idx) => (
              <div key={item.id || idx} className="p-3 bg-slate-900 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-white">{item.clientCode}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
                      {item.screenName || 'Screen'}
                    </span>
                    {item.targetBranch && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-sky-950/60 text-sky-400 border border-sky-800/50">
                        {item.targetBranch}
                      </span>
                    )}
                  </div>

                  <div>
                    {item.status === 'QUEUED' && (
                      <span className="flex items-center gap-1 text-[11px] text-slate-400">
                        <Clock className="w-3.5 h-3.5" /> QUEUED
                      </span>
                    )}
                    {item.status === 'OPENING' && (
                      <span className="flex items-center gap-1 text-[11px] text-sky-400 font-medium">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> OPENING
                      </span>
                    )}
                    {item.status === 'LOGIN_SUCCESS' && (
                      <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                        <CheckCircle className="w-3.5 h-3.5" /> LOGIN_SUCCESS
                      </span>
                    )}
                    {item.status === 'BRANCH_SELECTED' && (
                      <span className="flex items-center gap-1 text-[11px] text-sky-400 font-semibold">
                        <CheckCircle className="w-3.5 h-3.5" /> BRANCH_SELECTED
                      </span>
                    )}
                    {(item.status === 'READY' || item.status === 'NAVIGATION_SUCCESS') && (
                      <span className="flex items-center gap-1 text-[11px] text-emerald-300 font-bold">
                        <CheckCircle className="w-3.5 h-3.5" /> READY
                      </span>
                    )}
                    {item.status === 'FAILED' && (
                      <span className="flex items-center gap-1 text-[11px] text-rose-400 font-bold">
                        <XCircle className="w-3.5 h-3.5" /> FAILED
                      </span>
                    )}
                  </div>
                </div>

                {item.status === 'FAILED' && item.errorMessage && (
                  <div className="text-xs text-rose-400 bg-rose-950/40 p-2 rounded border border-rose-800/40 font-mono">
                    ✕ {item.errorMessage}
                  </div>
                )}

                {item.finalUrl && (
                  <div className="text-[11px] text-slate-400 truncate font-mono">
                    → {item.finalUrl}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setMultiTabModalOpen(false)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
