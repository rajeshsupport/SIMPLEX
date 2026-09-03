import React, { useEffect, useState, useRef } from 'react';
import {
  Users,
  Plus,
  KeyRound,
  Eye,
  EyeOff,
  Edit2,
  Power,
  RefreshCw,
  Search,
  Loader2,
  Upload,
  Download,
  AlertTriangle,
  CheckCircle,
  XCircle,
  FileSpreadsheet,
  Building2,
  Phone,
  Mail,
  Globe,
  Shield,
  Copy,
  Clock,
  UserCheck,
  UserX,
  ExternalLink,
} from 'lucide-react';
import { ApiClient } from '../api/client.js';
import { Modal } from '../components/Modal.js';
import { EnvironmentBadge } from '../components/EnvironmentBadge.js';
import {
  ClientUser,
  ClientUserListResponse,
  CreateClientUserDto,
  UpdateClientUserDto,
  ClientWithCredentialInfo,
  ExcelUserImportPreviewResult,
  ExcelUserImportExecutionSummary,
  PERMISSIONS,
} from '@hmc/shared';
import { useAuth } from '../context/AuthContext.js';

export const UsersPage: React.FC = () => {
  const [clients, setClients] = useState<ClientWithCredentialInfo[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [users, setUsers] = useState<ClientUser[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const limit = 20;

  // Options
  const [clientOptions, setClientOptions] = useState<{
    nationalities: string[];
    roles: string[];
    profileRoles: string[];
  }>({
    nationalities: ['Saudi Arabia', 'United Arab Emirates', 'United States', 'United Kingdom', 'India', 'Egypt', 'Jordan', 'Pakistan', 'Philippines', 'Other'],
    roles: ['Physician', 'Nurse', 'Admin', 'Pharmacist', 'Lab Technician', 'Operator', 'Super User'],
    profileRoles: ['Clinical Specialist', 'General Practitioner', 'Head Nurse', 'Chief Pharmacist', 'System Administrator', 'Billing Specialist'],
  });

  // Modals state
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const [selectedUser, setSelectedUser] = useState<ClientUser | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Forms
  const [createForm, setCreateForm] = useState<CreateClientUserDto>({
    clientId: '',
    username: '',
    firstName: '',
    middleName: '',
    lastName: '',
    nickName: '',
    email: '',
    mobileNumber: '',
    nationality: 'Saudi Arabia',
    role: 'Physician',
    profileRole: 'Clinical Specialist',
    barcodeNumber: '',
    signatureBase64: '',
    signatureFilename: '',
    stampBase64: '',
    stampFilename: '',
    profileBase64: '',
    profileFilename: '',
    status: 'ACTIVE',
    overrideDuplicateName: false,
  });

  const [editForm, setEditForm] = useState<UpdateClientUserDto>({
    firstName: '',
    middleName: '',
    lastName: '',
    nickName: '',
    email: '',
    mobileNumber: '',
    nationality: '',
    role: '',
    profileRole: '',
    barcodeNumber: '',
    status: 'ACTIVE',
  });

  const [createError, setCreateError] = useState<string | null>(null);
  const [potentialDuplicate, setPotentialDuplicate] = useState<{
    username: string;
    fullName: string;
    mobileNumber?: string;
    status: string;
  } | null>(null);

  // Temporary password capture state (one-time reveal)
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [passwordCountdown, setPasswordCountdown] = useState<number>(60);
  const [copied, setCopied] = useState(false);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Excel Import state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ExcelUserImportPreviewResult | null>(null);
  const [importExecution, setImportExecution] = useState<ExcelUserImportExecutionSummary | null>(null);
  const [importing, setImporting] = useState(false);

  const { hasPermission, isSuperAdmin } = useAuth();
  const [isAgentOnline, setIsAgentOnline] = useState<boolean>(true);

  // Check agent status
  useEffect(() => {
    const checkAgent = async () => {
      try {
        const agents = await ApiClient.request<any[]>('/agents');
        const online = (agents || []).some(
          (a) => a.status === 'ONLINE' || a.status === 'BUSY'
        );
        setIsAgentOnline(online);
      } catch {
        setIsAgentOnline(true);
      }
    };
    checkAgent();
    const interval = setInterval(checkAgent, 10000);
    return () => clearInterval(interval);
  }, []);

  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const isProduction = selectedClient?.environment?.toUpperCase() === 'PRODUCTION';

  const canCreate = isSuperAdmin || hasPermission(PERMISSIONS.CLIENT_USERS_CREATE);
  const canEdit = isSuperAdmin || hasPermission(PERMISSIONS.CLIENT_USERS_EDIT);
  const canChangeStatus = isSuperAdmin || hasPermission(PERMISSIONS.CLIENT_USERS_STATUS_CHANGE);
  const canResetPassword = isSuperAdmin || hasPermission(PERMISSIONS.CLIENT_USER_PASSWORD_RESET);
  const canImport = isSuperAdmin || hasPermission(PERMISSIONS.CLIENT_USERS_IMPORT);
  const canExport = isSuperAdmin || hasPermission(PERMISSIONS.CLIENT_USERS_EXPORT);

  const getMutationState = (baseTitle: string): { title: string; disabled: boolean } => {
    if (isProduction) {
      return { title: 'Production mutation requires separate authorization.', disabled: true };
    }
    if (!isAgentOnline) {
      return { title: 'Desktop automation agent is offline.', disabled: true };
    }
    return { title: baseTitle, disabled: false };
  };

  // Load clients on mount
  useEffect(() => {
    const loadClients = async () => {
      try {
        const data = await ApiClient.request<ClientWithCredentialInfo[]>('/clients');
        setClients(data || []);
        if (data && data.length > 0 && !selectedClientId) {
          setSelectedClientId(data[0].id);
        }
      } catch (err) {
        console.error('Failed to load clients', err);
      }
    };
    loadClients();
  }, []);

  const [formMetadata, setFormMetadata] = useState<any>(null);
  const [isConfirmingCreate, setIsConfirmingCreate] = useState(false);
  const reqIdRef = useRef<number>(0);

  const handleClientChange = (newClientId: string) => {
    if (newClientId === selectedClientId) return;
    reqIdRef.current++;
    // 1. Immediately clear displayed rows
    setUsers([]);
    setTotalCount(0);
    setLastSyncedAt(null);
    // 2. Clear filters
    setSearch('');
    setStatusFilter('ALL');
    setRoleFilter('ALL');
    setPage(1);
    setActionMessage(null);
    setSelectedClientId(newClientId);
  };

  // Load users when client or filters change
  const loadUsers = async () => {
    if (!selectedClientId) {
      setUsers([]);
      setTotalCount(0);
      return;
    }
    const currentReqId = ++reqIdRef.current;
    try {
      setLoading(true);
      const res = await ApiClient.request<ClientUserListResponse>(
        `/client-users?clientId=${selectedClientId}&search=${encodeURIComponent(search)}&status=${statusFilter}&role=${encodeURIComponent(roleFilter)}&page=${page}&limit=${limit}`
      );
      // Discard stale responses
      if (currentReqId !== reqIdRef.current) return;
      setUsers(res.users || []);
      setTotalCount(res.totalCount || 0);
      setLastSyncedAt(res.lastSyncedAt || null);
      if (res.liveClientOptions) {
        const toStrings = (arr: any[]): string[] => {
          if (!Array.isArray(arr)) return [];
          return arr
            .map((item: any) =>
              typeof item === 'string' ? item : (item?.label || item?.value || '')
            )
            .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
        };

        setClientOptions({
          nationalities: toStrings(res.liveClientOptions.nationalities),
          roles: toStrings(res.liveClientOptions.roles),
          profileRoles: toStrings(res.liveClientOptions.profileRoles),
        });
      }
    } catch (err: any) {
      if (currentReqId !== reqIdRef.current) return;
      console.error('Failed to load client users', err);
    } finally {
      if (currentReqId === reqIdRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadUsers();
  }, [selectedClientId, search, statusFilter, roleFilter, page]);

  const [syncProgressMessage, setSyncProgressMessage] = useState<string | null>(null);
  const [syncTerminalState, setSyncTerminalState] = useState<'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT' | null>(null);
  const [syncElapsedSeconds, setSyncElapsedSeconds] = useState<number>(0);
  const [activeSyncJobId, setActiveSyncJobId] = useState<string | null>(null);
  const [directoryStatus, setDirectoryStatus] = useState<'LIVE' | 'CACHED'>('CACHED');
  const syncTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleCancelSync = async () => {
    if (!activeSyncJobId) {
      setSyncing(false);
      setSyncProgressMessage('Sync cancelled by user.');
      setActionMessage({ type: 'error', text: 'Sync cancelled by user.' });
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
      return;
    }
    try {
      await ApiClient.request(`/client-users/sync-job/${activeSyncJobId}/cancel`, {
        method: 'POST',
      });
      setSyncProgressMessage('Sync cancelled by user.');
      setActionMessage({ type: 'error', text: 'Sync cancelled by user.' });
      setSyncTerminalState('CANCELLED');
    } catch (err: any) {
      console.error('Cancel sync failed', err);
    } finally {
      setSyncing(false);
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    }
  };

  // Sync Users
  const handleSyncUsers = async () => {
    if (!selectedClientId || syncing) return;
    setSyncing(true);
    setSyncElapsedSeconds(0);
    setSyncTerminalState(null);
    setSyncProgressMessage('Connecting to automation agent…');
    setActionMessage(null);

    if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    syncTimerRef.current = setInterval(() => {
      setSyncElapsedSeconds((prev) => prev + 1);
    }, 1000);

    let jobId: string | null = null;
    try {
      const syncJob = await ApiClient.request<{ jobId: string; status: string; message: string }>('/client-users/sync-job', {
        method: 'POST',
        body: JSON.stringify({ clientId: selectedClientId }),
      });

      jobId = syncJob.jobId;
      setActiveSyncJobId(jobId);

      const startTime = Date.now();
      let isComplete = false;

      while (!isComplete) {
        const elapsedTotal = Date.now() - startTime;
        if (elapsedTotal >= 90000) {
          const timeoutMsg = 'Sync timed out after 90 seconds. Previous cached data is still available.';
          setSyncProgressMessage(timeoutMsg);
          setActionMessage({
            type: 'error',
            text: timeoutMsg,
          });
          setSyncTerminalState('TIMED_OUT');
          break;
        }

        await new Promise((r) => setTimeout(r, 250));

        try {
          const statusRes = await ApiClient.request<{
            status: string;
            stage?: string;
            progressMessage?: string;
            errorMessage?: string;
            errorCode?: string;
            totalScraped?: number;
            liveStatus?: 'LIVE' | 'CACHED';
            streamedUsers?: any[];
          }>(`/client-users/sync-status/${jobId}`);

          if (statusRes.progressMessage) {
            setSyncProgressMessage(statusRes.progressMessage);
          }

          if (['SUCCEEDED', 'COMPLETED'].includes(statusRes.status)) {
            isComplete = true;
            setDirectoryStatus('LIVE');
            setSyncTerminalState('SUCCEEDED');
            const successMsg = `${statusRes.totalScraped || 0} users synchronized successfully.`;
            setSyncProgressMessage(successMsg);
            setActionMessage({
              type: 'success',
              text: `✓ ${successMsg}`,
            });
            await loadUsers();
            break;
          } else if (statusRes.status === 'CANCELLED') {
            isComplete = true;
            setSyncTerminalState('CANCELLED');
            setSyncProgressMessage('Sync cancelled by user.');
            setActionMessage({ type: 'error', text: 'Sync cancelled by user.' });
            break;
          } else if (statusRes.status === 'TIMED_OUT') {
            isComplete = true;
            setSyncTerminalState('TIMED_OUT');
            const timeoutMsg = statusRes.errorMessage || 'Sync timed out. Previous cached data is still available.';
            setSyncProgressMessage(timeoutMsg);
            setActionMessage({ type: 'error', text: timeoutMsg });
            break;
          } else if (statusRes.status === 'FAILED') {
            isComplete = true;
            setSyncTerminalState('FAILED');
            let friendlyError = statusRes.errorMessage || 'Background user sync failed.';
            if (statusRes.errorCode === 'DESKTOP_AGENT_OFFLINE') {
              friendlyError = 'Automation agent is offline.';
            } else if (statusRes.errorCode === 'CLIENT_BACKGROUND_LOGIN_FAILED') {
              friendlyError = 'Background authentication failed on client portal. Check saved credentials.';
            } else if (statusRes.errorCode === 'CLIENT_USER_ROUTE_VERSION_MISMATCH') {
              friendlyError = 'Application version does not match configured users route.';
            } else if (statusRes.errorCode === 'CLIENT_USER_TABLE_NOT_FOUND') {
              friendlyError = 'User directory table could not be identified on client portal.';
            } else if (statusRes.errorCode === 'CLIENT_USER_ACCESS_DENIED') {
              friendlyError = 'Client portal returned Access Denied for configured users route.';
            }
            const cleanError = friendlyError.replace(/^Sync failed:\s*/i, '');
            const failMsg = `Sync failed: ${cleanError}`;
            setSyncProgressMessage(failMsg);
            setActionMessage({ type: 'error', text: failMsg });
            break;
          }
        } catch (err: any) {
          if (err?.status === 404) {
            isComplete = true;
            setSyncTerminalState('FAILED');
            setSyncProgressMessage('Sync failed: Sync job not found.');
            setActionMessage({ type: 'error', text: 'Sync failed: Sync job not found.' });
            break;
          }
        }
      }
    } catch (err: any) {
      setSyncTerminalState('FAILED');
      let friendlyError = err.message || 'Sync failed';
      if (err.response?.code === 'DESKTOP_AGENT_OFFLINE' || err.message?.includes('offline')) {
        friendlyError = 'Automation agent is offline.';
      }
      const cleanError = friendlyError.replace(/^Sync failed:\s*/i, '');
      const failMsg = `Sync failed: ${cleanError}`;
      setSyncProgressMessage(failMsg);
      setActionMessage({ type: 'error', text: failMsg });
    } finally {
      setSyncing(false);
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    }
  };

  // Open Create Modal and fetch live metadata
  const handleOpenCreateModal = async () => {
    if (!selectedClientId) {
      setActionMessage({ type: 'error', text: 'Please select a target client first.' });
      return;
    }
    setCreateError(null);
    setPotentialDuplicate(null);
    setIsConfirmingCreate(false);
    setCreateForm({
      clientId: selectedClientId,
      username: '',
      firstName: '',
      middleName: '',
      lastName: '',
      nickName: '',
      email: '',
      mobileNumber: '',
      nationality: 'Saudi Arabia',
      role: 'Physician',
      profileRole: 'Clinical Specialist',
      barcodeNumber: '',
      signatureBase64: '',
      signatureFilename: '',
      stampBase64: '',
      stampFilename: '',
      profileBase64: '',
      profileFilename: '',
      status: 'ACTIVE',
      overrideDuplicateName: false,
    });
    setIsCreateModalOpen(true);

    try {
      const meta = await ApiClient.request<any>(`/client-users/form-options?clientId=${selectedClientId}`);
      setFormMetadata(meta);
      if (meta && meta.nationalities && meta.nationalities.length > 0) {
        const defaultNat = meta.nationalities[0].value || meta.nationalities[0].label;
        const defaultRole = meta.roles?.[0]?.value || meta.roles?.[0]?.label || 'Physician';
        const matchingProf = meta.profileRoles?.find((p: any) => !p.roleDependency || p.roleDependency.toLowerCase() === defaultRole.toLowerCase());
        setCreateForm((prev) => ({
          ...prev,
          nationality: defaultNat,
          role: defaultRole,
          profileRole: matchingProf ? (matchingProf.value || matchingProf.label) : '',
        }));
      }
    } catch (err) {
      console.error('Failed to fetch live form options', err);
    }
  };

  // Create User
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId) {
      setCreateError('Client ID is required.');
      return;
    }
    if (!isConfirmingCreate) {
      setIsConfirmingCreate(true);
      return;
    }

    setCreateError(null);
    setPotentialDuplicate(null);

    try {
      const payload: CreateClientUserDto = {
        ...createForm,
        clientId: selectedClientId,
      };

      const res = await ApiClient.request<ClientUser>('/client-users', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setIsCreateModalOpen(false);
      setIsConfirmingCreate(false);
      setActionMessage({ type: 'success', text: `✓ User '${res.username}' created and verified on client.` });
      await loadUsers();
    } catch (err: any) {
      setIsConfirmingCreate(false);
      const code = err.response?.code || err.code;
      const msg = err.message || err.response?.message;
      if (code === 'POTENTIAL_DUPLICATE_NAME') {
        setCreateError(msg || 'Possible duplicate name detected.');
        setPotentialDuplicate(err.response?.potentialDuplicateOf);
      } else if (code === 'DUPLICATE_USERNAME') {
        setCreateError(`Duplicate username: user '${createForm.username}' already exists for this client.`);
      } else if (code === 'CLIENT_ID_REQUIRED') {
        setCreateError('Target client ID is required.');
      } else if (code === 'REMOTE_FORM_FIELD_NOT_FOUND') {
        setCreateError(msg || 'A required field was not found on the live Simplex form.');
      } else if (code === 'REMOTE_DROPDOWN_OPTION_NOT_FOUND') {
        setCreateError(msg || 'Selected dropdown option not found on the live Simplex form.');
      } else if (code === 'REMOTE_FORM_VALUE_MISMATCH') {
        setCreateError('Form value mismatch during pre-submission read-back verification.');
      } else if (code === 'REMOTE_USER_NOT_FOUND_AFTER_CREATE') {
        setCreateError(`User '${createForm.username}' was not found on the remote user list after creation.`);
      } else if (code === 'CLIENT_USER_COUNT_MISMATCH') {
        setCreateError('Count mismatch: Central count does not match live client count.');
      } else if (code === 'DESKTOP_AGENT_OFFLINE' || code === 'AGENT_OFFLINE') {
        setCreateError('Automation agent is offline.');
      } else if (code === 'OPERATION_TIMED_OUT') {
        setCreateError('Operation timed out on remote client.');
      } else {
        setCreateError(msg || 'Failed to create user on client.');
      }
    }
  };

  // Edit User (Save & Update Simplex)
  const [isMutatingEdit, setIsMutatingEdit] = useState(false);
  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || isMutatingEdit) return;
    setIsMutatingEdit(true);
    try {
      await ApiClient.request(`/client-users/${selectedUser.id}`, {
        method: 'PUT',
        body: JSON.stringify(editForm),
      });
      setIsEditModalOpen(false);
      setActionMessage({ type: 'success', text: `✓ User '${selectedUser.username}' updated and verified in ${selectedClient?.clientCode || 'Simplex'}.` });
      await loadUsers();
    } catch (err: any) {
      const cleanError = (err.message || 'Update failed').replace(/^Sync failed:\s*/i, '');
      setActionMessage({ type: 'error', text: `Update failed: ${cleanError}` });
    } finally {
      setIsMutatingEdit(false);
    }
  };

  // Status Change (Activate/Deactivate in Simplex)
  const [isMutatingStatus, setIsMutatingStatus] = useState(false);
  const handleStatusChange = async () => {
    if (!selectedUser || isMutatingStatus) return;
    const nextStatus = selectedUser.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setIsMutatingStatus(true);
    try {
      await ApiClient.request(`/client-users/${selectedUser.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: nextStatus }),
      });
      setIsStatusModalOpen(false);
      setActionMessage({ type: 'success', text: `✓ User '${selectedUser.username}' status updated to ${nextStatus} in ${selectedClient?.clientCode || 'Simplex'}.` });
      await loadUsers();
    } catch (err: any) {
      const cleanError = (err.message || 'Status update failed').replace(/^Sync failed:\s*/i, '');
      setActionMessage({ type: 'error', text: `Status update failed: ${cleanError}` });
    } finally {
      setIsMutatingStatus(false);
    }
  };

  // Password Reset in Simplex
  const [isResetConfirmModalOpen, setIsResetConfirmModalOpen] = useState(false);
  const [isMutatingReset, setIsMutatingReset] = useState(false);
  const handleResetPasswordExecute = async () => {
    if (!selectedUser || isMutatingReset) return;
    setIsMutatingReset(true);
    try {
      const res = await ApiClient.request<{ temporaryPassword?: string; message: string }>(
        `/client-users/${selectedUser.id}/reset-password`,
        { method: 'POST' }
      );
      setIsResetConfirmModalOpen(false);
      if (res.temporaryPassword) {
        setTempPassword(res.temporaryPassword);
        setShowPassword(false);
        setPasswordCountdown(60);
        setIsResetModalOpen(true);

        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = setInterval(() => {
          setPasswordCountdown((prev) => {
            if (prev <= 1) {
              if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
              setTempPassword(null);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        setActionMessage({ type: 'success', text: `✓ ${res.message || 'Password reset completed in the selected Simplex client.'}` });
      }
    } catch (err: any) {
      const cleanError = (err.message || 'Password reset failed').replace(/^Sync failed:\s*/i, '');
      setActionMessage({ type: 'error', text: `Password reset failed: ${cleanError}` });
    } finally {
      setIsMutatingReset(false);
    }
  };

  // Excel Export
  const handleExportExcel = () => {
    if (!selectedClientId) return;
    window.open(`/api/v1/client-users/export-excel?clientId=${selectedClientId}`, '_blank');
  };

  // Excel Import Template
  const handleDownloadTemplate = () => {
    window.open(`/api/v1/client-users/import-template`, '_blank');
  };

  // Excel Import Preview
  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    setImportPreview(null);
    setImportExecution(null);

    const formData = new FormData();
    formData.append('clientId', selectedClientId);
    formData.append('file', file);

    try {
      setImporting(true);
      const res = await fetch(`/api/v1/client-users/import-preview`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ApiClient.getAccessToken()}`,
        },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Validation failed');
      setImportPreview(data);
    } catch (err: any) {
      alert(`Import Validation Error: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  // Excel Import Execute
  const handleImportExecute = async () => {
    if (!importPreview || !selectedClientId) return;
    try {
      setImporting(true);
      const res = await ApiClient.request<ExcelUserImportExecutionSummary>('/client-users/import-execute', {
        method: 'POST',
        body: JSON.stringify({
          clientId: selectedClientId,
          rows: importPreview.rows,
        }),
      });
      setImportExecution(res);
      setActionMessage({ type: 'success', text: `✓ Import complete: ${res.succeededRows} succeeded, ${res.failedRows} failed, ${res.skippedRows} skipped.` });
      await loadUsers();
    } catch (err: any) {
      alert(`Import execution failed: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  // Helper for file to base64
  const handleFileToBase64 = (file: File, callback: (base64: string, filename: string) => void) => {
    const reader = new FileReader();
    reader.onload = () => {
      callback(reader.result as string, file.name);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      {/* Header & Client Selector */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Users className="w-6 h-6 text-sky-400" />
            Central Client User Directory
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time management, automated directory synchronization, and Excel operations via isolated browser agent
          </p>
        </div>

        {/* Client Selector Dropdown */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-slate-400 whitespace-nowrap">Target Client:</label>
          <select
            value={selectedClientId}
            onChange={(e) => handleClientChange(e.target.value)}
            className="px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs font-semibold text-sky-300 focus:outline-none focus:border-sky-500 shadow-md min-w-[280px]"
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.clientCode} — {c.clientName} — {c.environment}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Selected Client Info Card */}
      {selectedClient && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-md flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-6">
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Client Code</span>
              <span className="font-mono font-bold text-white text-sm">{selectedClient.clientCode}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Hospital / Instance</span>
              <span className="font-semibold text-slate-200">{selectedClient.clientName}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Environment</span>
              <EnvironmentBadge environment={selectedClient.environment} />
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Client Endpoint</span>
              <span className="font-mono text-slate-400">{selectedClient.baseUrl}</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Directory Status</span>
              <div className="flex items-center gap-1.5 justify-end">
                <span className={`w-2 h-2 rounded-full ${directoryStatus === 'LIVE' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                <span className="text-slate-300 font-mono text-xs">
                  {directoryStatus === 'LIVE' ? 'LIVE' : 'CACHED'}
                  {lastSyncedAt ? ` — ${new Date(lastSyncedAt).toLocaleTimeString()}` : ''}
                </span>
              </div>
            </div>

            <button
              onClick={handleSyncUsers}
              disabled={syncing}
              className="flex items-center gap-2 px-3.5 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-semibold shadow-lg shadow-sky-950/50 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync Users'}
            </button>
          </div>
        </div>
      )}

      {syncing && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-sky-950/50 border-sky-800 text-sky-300 text-xs font-semibold shadow-md">
          <div className="flex items-center gap-2.5">
            <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
            <span>{syncProgressMessage || 'Connecting to automation agent…'}</span>
            <span className="text-slate-400 font-mono text-[11px]">({syncElapsedSeconds}s)</span>
          </div>
          <button
            onClick={handleCancelSync}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-950/80 hover:bg-red-900 border border-red-800 text-red-300 rounded text-xs font-medium transition-colors shadow-sm"
          >
            <XCircle className="w-3.5 h-3.5" />
            Cancel Sync
          </button>
        </div>
      )}

      {!syncing && syncProgressMessage && !actionMessage && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-slate-900 border-slate-800 text-slate-300 text-xs font-medium">
          <span>{syncProgressMessage}</span>
          {(syncTerminalState === 'FAILED' || syncTerminalState === 'TIMED_OUT') && (
            <button
              onClick={handleSyncUsers}
              className="flex items-center gap-1 px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-xs font-semibold transition-colors shadow-sm"
            >
              <RefreshCw className="w-3 h-3" />
              Retry Sync
            </button>
          )}
        </div>
      )}

      {actionMessage && (
        <div
          className={`flex items-center justify-between p-3 rounded-lg border text-xs font-medium ${
            actionMessage.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
              : actionMessage.type === 'error'
              ? 'bg-red-950/60 border-red-800 text-red-300'
              : 'bg-sky-950/60 border-sky-800 text-sky-300'
          }`}
        >
          <span>{actionMessage.text}</span>
          {(syncTerminalState === 'FAILED' || syncTerminalState === 'TIMED_OUT') && (
            <button
              onClick={handleSyncUsers}
              className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded text-xs font-semibold transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Retry Sync
            </button>
          )}
        </div>
      )}

      {/* Toolbar & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 p-4 rounded-xl border border-slate-800">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search by username, full name, email, or mobile..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-4 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="flex items-center gap-1.5">
            {['ALL', 'ACTIVE', 'INACTIVE'].map((st) => (
              <button
                key={st}
                onClick={() => {
                  setStatusFilter(st);
                  setPage(1);
                }}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  statusFilter === st
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(1);
            }}
            className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-sky-500"
          >
            <option value="ALL">All Roles</option>
            {clientOptions.roles.map((r: any) => {
              const val = typeof r === 'string' ? r : (r?.label || r?.value || '');
              return (
                <option key={val} value={val}>
                  {val}
                </option>
              );
            })}
          </select>
        </div>

        <div className="flex items-center gap-2">
          {canImport && (
            <button
              onClick={() => setIsImportModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-colors border border-slate-700"
            >
              <Upload className="w-3.5 h-3.5" />
              Import Excel
            </button>
          )}

          {canExport && (
            <button
              onClick={handleExportExcel}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-colors border border-slate-700"
            >
              <Download className="w-3.5 h-3.5" />
              Export Excel
            </button>
          )}

          {canCreate && (
            <button
              disabled={isProduction}
              title={isProduction ? 'Production mutation requires separate authorization.' : 'Create User'}
              onClick={handleOpenCreateModal}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold shadow transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Create User
            </button>
          )}
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 text-[11px] uppercase font-semibold border-b border-slate-800">
              <tr>
                <th className="px-4 py-3">S.No</th>
                <th className="px-4 py-3">Full Name</th>
                <th className="px-4 py-3">Username</th>
                <th className="px-4 py-3">Mobile Number</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Nationality</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Profile Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created Date/Time</th>
                <th className="px-4 py-3">Updated Date/Time</th>
                <th className="px-4 py-3">Last Synced</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={13} className="px-4 py-8 text-center text-slate-500">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-sky-500" />
                    Loading client users...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-4 py-8 text-center text-slate-500">
                    No users found matching criteria. Click "Sync Users" to pull the live directory.
                  </td>
                </tr>
              ) : (
                users.map((u, idx) => {
                  const sNo = (page - 1) * limit + idx + 1;
                  const isActive = u.status === 'ACTIVE';

                  return (
                    <tr key={u.id} className="hover:bg-slate-850/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-slate-500">{sNo}</td>
                      <td className="px-4 py-3 font-semibold text-white">{u.fullName}</td>
                      <td className="px-4 py-3 font-mono text-sky-400">{u.username}</td>
                      <td className="px-4 py-3 font-mono">{u.mobileNumber || '—'}</td>
                      <td className="px-4 py-3 text-slate-400">{u.email || '—'}</td>
                      <td className="px-4 py-3">{u.nationality || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded text-[10px] font-medium border border-slate-700">
                          {u.role || 'Unassigned'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{u.profileRole || '—'}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            isActive
                              ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                              : 'bg-red-950 text-red-400 border-red-800'
                          }`}
                        >
                          {u.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{u.remoteCreatedAt || 'Not available'}</td>
                      <td className="px-4 py-3 text-slate-500">{u.remoteUpdatedAt || 'Not available'}</td>
                      <td className="px-4 py-3 font-mono text-[10px] text-slate-500">
                        {new Date(u.lastSyncedAt).toLocaleTimeString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* View */}
                          <button
                            onClick={() => {
                              setSelectedUser(u);
                              setIsViewModalOpen(true);
                            }}
                            title="View"
                            aria-label={`View user ${u.username}`}
                            className="p-1.5 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded-lg transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          {/* Edit & Update Client */}
                          {canEdit && (() => {
                            const mutation = getMutationState('Edit & Update Client');
                            return (
                              <button
                                disabled={mutation.disabled}
                                onClick={() => {
                                  if (mutation.disabled) return;
                                  setSelectedUser(u);
                                  setEditForm({
                                    firstName: u.firstName,
                                    middleName: u.middleName || '',
                                    lastName: u.lastName,
                                    nickName: u.nickName || '',
                                    email: u.email || '',
                                    mobileNumber: u.mobileNumber || '',
                                    nationality: u.nationality || 'Saudi Arabia',
                                    role: u.role || '',
                                    profileRole: u.profileRole || '',
                                    barcodeNumber: u.barcodeNumber || '',
                                    status: u.status,
                                  });
                                  setIsEditModalOpen(true);
                                }}
                                title={mutation.title}
                                aria-label={`Edit & Update Client for ${u.username}`}
                                className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-40 disabled:hover:text-slate-400 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                            );
                          })()}

                          {/* Activate / Deactivate in Simplex */}
                          {canChangeStatus && (() => {
                            const actionLabel = isActive ? 'Deactivate in Simplex' : 'Activate in Simplex';
                            const mutation = getMutationState(actionLabel);
                            return (
                              <button
                                disabled={mutation.disabled}
                                onClick={() => {
                                  if (mutation.disabled) return;
                                  setSelectedUser(u);
                                  setIsStatusModalOpen(true);
                                }}
                                title={mutation.title}
                                aria-label={`${actionLabel} ${u.username}`}
                                className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                                  isActive
                                    ? 'text-emerald-400 hover:text-red-400 hover:bg-red-950/30'
                                    : 'text-red-400 hover:text-emerald-400 hover:bg-emerald-950/30'
                                }`}
                              >
                                <Power className="w-3.5 h-3.5" />
                              </button>
                            );
                          })()}

                          {/* Reset Password in Simplex */}
                          {canResetPassword && (() => {
                            const mutation = getMutationState('Reset Password in Simplex');
                            return (
                              <button
                                disabled={mutation.disabled}
                                onClick={() => {
                                  if (mutation.disabled) return;
                                  setSelectedUser(u);
                                  setIsResetConfirmModalOpen(true);
                                }}
                                title={mutation.title}
                                aria-label={`Reset Password in Simplex for ${u.username}`}
                                className="p-1.5 text-slate-400 hover:text-yellow-400 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-40 disabled:hover:text-slate-400 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                              >
                                <KeyRound className="w-3.5 h-3.5" />
                              </button>
                            );
                          })()}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {totalCount > limit && (
          <div className="flex items-center justify-between p-3 border-t border-slate-800 bg-slate-950 text-xs text-slate-400">
            <div>
              Showing {(page - 1) * limit + 1} to {Math.min(page * limit, totalCount)} of {totalCount} users
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-2.5 py-1 bg-slate-900 border border-slate-800 rounded hover:bg-slate-800 disabled:opacity-50"
              >
                Previous
              </button>
              <span className="font-mono text-white">Page {page}</span>
              <button
                disabled={page * limit >= totalCount}
                onClick={() => setPage((p) => p + 1)}
                className="px-2.5 py-1 bg-slate-900 border border-slate-800 rounded hover:bg-slate-800 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal: View User Details */}
      <Modal isOpen={isViewModalOpen} onClose={() => setIsViewModalOpen(false)} title={`User Details: ${selectedUser?.username}`}>
        {selectedUser && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3 bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div>
                <span className="text-slate-500 block">Username</span>
                <span className="font-mono font-bold text-sky-400">{selectedUser.username}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Status</span>
                <span
                  className={`font-bold ${
                    selectedUser.status === 'ACTIVE' ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {selectedUser.status}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">First Name</span>
                <span className="text-white">{selectedUser.firstName}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Last Name</span>
                <span className="text-white">{selectedUser.lastName}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Full Name</span>
                <span className="text-white">{selectedUser.fullName}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Nick Name</span>
                <span className="text-slate-300">{selectedUser.nickName || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Mobile Number</span>
                <span className="font-mono text-slate-300">{selectedUser.mobileNumber || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Email</span>
                <span className="text-slate-300">{selectedUser.email || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Nationality</span>
                <span className="text-slate-300">{selectedUser.nationality || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Role</span>
                <span className="text-slate-300">{selectedUser.role || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Profile Role</span>
                <span className="text-slate-300">{selectedUser.profileRole || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Barcode Number</span>
                <span className="font-mono text-slate-300">{selectedUser.barcodeNumber || '—'}</span>
              </div>
            </div>

            {/* Asset Previews */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-2 bg-slate-950 border border-slate-800 rounded text-center">
                <span className="text-[10px] text-slate-500 block mb-1">Signature</span>
                {selectedUser.hasSignature ? (
                  <span className="text-emerald-400 font-semibold">✓ Attached</span>
                ) : (
                  <span className="text-slate-600">None</span>
                )}
              </div>
              <div className="p-2 bg-slate-950 border border-slate-800 rounded text-center">
                <span className="text-[10px] text-slate-500 block mb-1">Stamp</span>
                {selectedUser.hasStamp ? (
                  <span className="text-emerald-400 font-semibold">✓ Attached</span>
                ) : (
                  <span className="text-slate-600">None</span>
                )}
              </div>
              <div className="p-2 bg-slate-950 border border-slate-800 rounded text-center">
                <span className="text-[10px] text-slate-500 block mb-1">Profile Photo</span>
                {selectedUser.hasProfileImage ? (
                  <span className="text-emerald-400 font-semibold">✓ Attached</span>
                ) : (
                  <span className="text-slate-600">None</span>
                )}
              </div>
            </div>

            <div className="text-[11px] text-slate-500 border-t border-slate-800 pt-3">
              Source Client: <span className="text-slate-300 font-medium">{selectedUser.clientName}</span> ({selectedUser.clientCode}) • Last Synced: <span className="font-mono">{new Date(selectedUser.lastSyncedAt).toLocaleString()}</span>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Create User */}
      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="Create User on Client Portal">
        <form onSubmit={handleCreateUser} className="space-y-4 text-xs">
          {createError && (
            <div className="p-3 bg-red-950/80 border border-red-800 rounded-lg text-red-200">
              <div className="font-bold flex items-center gap-1.5 mb-1">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                Validation Warning
              </div>
              {createError}

              {potentialDuplicate && (
                <div className="mt-2 p-2 bg-slate-900/90 rounded border border-red-800/50 text-[11px]">
                  <div>Matching User: <strong className="text-white">{potentialDuplicate.fullName}</strong> ({potentialDuplicate.username})</div>
                  <div>Mobile: {potentialDuplicate.mobileNumber || 'N/A'} • Status: {potentialDuplicate.status}</div>

                  <label className="flex items-center gap-2 mt-2 text-amber-300 font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={createForm.overrideDuplicateName}
                      onChange={(e) => setCreateForm({ ...createForm, overrideDuplicateName: e.target.checked })}
                    />
                    <span>Authorize Duplicate Name Override (Recorded in Audit Log)</span>
                  </label>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-slate-400 mb-1">User Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. jdoe"
              value={createForm.username}
              onChange={(e) => setCreateForm({ ...createForm, username: e.target.value.toLowerCase().trim() })}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-white focus:outline-none focus:border-sky-500 font-mono"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">First Name *</label>
              <input
                type="text"
                required
                value={createForm.firstName}
                onChange={(e) => setCreateForm({ ...createForm, firstName: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-white focus:outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Middle Name</label>
              <input
                type="text"
                value={createForm.middleName}
                onChange={(e) => setCreateForm({ ...createForm, middleName: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-white focus:outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Last Name *</label>
              <input
                type="text"
                required
                value={createForm.lastName}
                onChange={(e) => setCreateForm({ ...createForm, lastName: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-white focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Nick Name</label>
              <input
                type="text"
                value={createForm.nickName}
                onChange={(e) => setCreateForm({ ...createForm, nickName: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Email</label>
              <input
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Mobile No *</label>
              <input
                type="tel"
                required
                value={createForm.mobileNumber}
                onChange={(e) => setCreateForm({ ...createForm, mobileNumber: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-white font-mono"
              />
            </div>
          </div>

          {/* Live Dropdowns */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Nationality *</label>
              <select
                value={createForm.nationality}
                onChange={(e) => setCreateForm({ ...createForm, nationality: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-white"
              >
                {(formMetadata?.nationalities?.length
                  ? formMetadata.nationalities.map((n: any) => (typeof n === 'string' ? n : n?.label || n?.value || ''))
                  : clientOptions.nationalities
                ).map((n: any) => {
                  const val = typeof n === 'string' ? n : (n?.label || n?.value || '');
                  return (
                    <option key={val} value={val}>
                      {val}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Role</label>
              <select
                value={createForm.role}
                onChange={(e) => {
                  const newRole = e.target.value;
                  let matchingProf = '';
                  if (formMetadata?.profileRoles) {
                    const prof = formMetadata.profileRoles.find(
                      (p: any) => p.roleDependency && p.roleDependency.toLowerCase() === newRole.toLowerCase()
                    );
                    if (prof) matchingProf = typeof prof === 'string' ? prof : prof?.label || prof?.value || '';
                  }
                  setCreateForm({ ...createForm, role: newRole, profileRole: matchingProf });
                }}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-white"
              >
                {(formMetadata?.roles?.length
                  ? formMetadata.roles.map((r: any) => (typeof r === 'string' ? r : r?.label || r?.value || ''))
                  : clientOptions.roles
                ).map((r: any) => {
                  const val = typeof r === 'string' ? r : (r?.label || r?.value || '');
                  return (
                    <option key={val} value={val}>
                      {val}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Profile Role</label>
              <select
                value={createForm.profileRole}
                onChange={(e) => setCreateForm({ ...createForm, profileRole: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-white"
              >
                {(formMetadata?.profileRoles?.length
                  ? formMetadata.profileRoles
                      .filter(
                        (pr: any) =>
                          !pr.roleDependency ||
                          pr.roleDependency.toLowerCase() === (createForm.role || '').toLowerCase()
                      )
                      .map((pr: any) => (typeof pr === 'string' ? pr : pr?.label || pr?.value || ''))
                  : clientOptions.profileRoles
                ).map((pr: any) => {
                  const val = typeof pr === 'string' ? pr : (pr?.label || pr?.value || '');
                  return (
                    <option key={val} value={val}>
                      {val}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Barcode No</label>
            <input
              type="text"
              value={createForm.barcodeNumber}
              onChange={(e) => setCreateForm({ ...createForm, barcodeNumber: e.target.value })}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-white font-mono"
            />
          </div>

          {/* File Uploads */}
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-800">
            <div>
              <label className="block text-slate-400 mb-1">Signature</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileToBase64(f, (b64, name) => setCreateForm({ ...createForm, signatureBase64: b64, signatureFilename: name }));
                }}
                className="text-[11px] text-slate-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-slate-800 file:text-slate-300"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Stamp</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileToBase64(f, (b64, name) => setCreateForm({ ...createForm, stampBase64: b64, stampFilename: name }));
                }}
                className="text-[11px] text-slate-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-slate-800 file:text-slate-300"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Profile Photo</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileToBase64(f, (b64, name) => setCreateForm({ ...createForm, profileBase64: b64, profileFilename: name }));
                }}
                className="text-[11px] text-slate-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-slate-800 file:text-slate-300"
              />
            </div>
          </div>

          {isConfirmingCreate && (
            <div className="p-3 bg-sky-950/80 border border-sky-800 rounded-lg text-sky-200">
              <div className="font-bold flex items-center gap-1.5 mb-2">
                <CheckCircle className="w-4 h-4 text-sky-400" />
                Confirm Remote User Creation
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-900/90 p-2.5 rounded border border-sky-800/40">
                <div>Target Client: <strong className="text-white">{selectedClient?.clientCode}</strong></div>
                <div>Username: <strong className="font-mono text-white">{createForm.username}</strong></div>
                <div>Full Name: <strong className="text-white">{createForm.firstName} {createForm.lastName}</strong></div>
                <div>Mobile: <strong className="text-white">{createForm.mobileNumber}</strong></div>
                <div>Nationality: <strong className="text-white">{createForm.nationality}</strong></div>
                <div>Role: <strong className="text-white">{createForm.role}</strong></div>
              </div>
              <p className="mt-2 text-[11px] text-slate-300">
                This action will submit and verify the user directly on the selected Simplex client portal, then pull the updated directory.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
            {isConfirmingCreate ? (
              <>
                <button
                  type="button"
                  onClick={() => setIsConfirmingCreate(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold"
                >
                  Back to Edit
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-semibold shadow-lg shadow-emerald-950/50"
                >
                  Confirm & Create on Client
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded font-semibold shadow-lg shadow-sky-950/50"
                >
                  Review & Create User
                </button>
              </>
            )}
          </div>
        </form>
      </Modal>

      {/* Modal: Edit & Update Client User */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => !isMutatingEdit && setIsEditModalOpen(false)}
        title={`Edit & Update Client: ${selectedUser?.username}`}
      >
        <form onSubmit={handleEditUser} className="space-y-4 text-xs">
          <div className="p-2.5 bg-slate-950/80 border border-slate-800 rounded text-slate-400 text-[11px]">
            Target Client: <span className="text-white font-semibold">{selectedClient?.clientCode}</span> • Username: <span className="text-sky-400 font-mono font-semibold">{selectedUser?.username}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">First Name *</label>
              <input
                type="text"
                required
                value={editForm.firstName}
                onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Last Name *</label>
              <input
                type="text"
                required
                value={editForm.lastName}
                onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Mobile Number *</label>
              <input
                type="tel"
                required
                value={editForm.mobileNumber}
                onChange={(e) => setEditForm({ ...editForm, mobileNumber: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-white font-mono"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Email</label>
              <input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Role</label>
              <select
                value={editForm.role}
                onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-white"
              >
                {clientOptions.roles.map((r: any) => {
                  const val = typeof r === 'string' ? r : (r?.label || r?.value || '');
                  return (
                    <option key={val} value={val}>
                      {val}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Profile Role</label>
              <select
                value={editForm.profileRole}
                onChange={(e) => setEditForm({ ...editForm, profileRole: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-white"
              >
                {clientOptions.profileRoles.map((pr: any) => {
                  const val = typeof pr === 'string' ? pr : (pr?.label || pr?.value || '');
                  return (
                    <option key={val} value={val}>
                      {val}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              disabled={isMutatingEdit}
              onClick={() => setIsEditModalOpen(false)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isMutatingEdit}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded font-semibold shadow disabled:opacity-50"
            >
              {isMutatingEdit ? 'Updating Simplex…' : 'Save & Update Simplex'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Activate/Deactivate Confirmation in Simplex */}
      <Modal
        isOpen={isStatusModalOpen}
        onClose={() => !isMutatingStatus && setIsStatusModalOpen(false)}
        title={selectedUser?.status === 'ACTIVE' ? 'Deactivate in Simplex' : 'Activate in Simplex'}
      >
        {selectedUser && (
          <div className="space-y-4 text-xs">
            <p className="text-slate-300 text-sm">
              {selectedUser.status === 'ACTIVE'
                ? `Deactivate ${selectedUser.username} in ${selectedClient?.clientCode || selectedUser.clientName}? This will update the selected Simplex client application.`
                : `Activate ${selectedUser.username} in ${selectedClient?.clientCode || selectedUser.clientName}? This will update the selected Simplex client application.`}
            </p>
            <p className="text-slate-500 text-[11px]">
              This will execute the real status change on the target Simplex client application via the desktop automation agent, verify remote success, and automatically pull the updated status into Central Console.
            </p>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                disabled={isMutatingStatus}
                onClick={() => setIsStatusModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isMutatingStatus}
                onClick={handleStatusChange}
                className={`px-4 py-2 rounded font-semibold text-white shadow disabled:opacity-50 ${
                  selectedUser.status === 'ACTIVE'
                    ? 'bg-red-600 hover:bg-red-500'
                    : 'bg-emerald-600 hover:bg-emerald-500'
                }`}
              >
                {isMutatingStatus
                  ? 'Updating in Simplex…'
                  : selectedUser.status === 'ACTIVE'
                  ? 'Deactivate in Simplex'
                  : 'Activate in Simplex'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Reset Password in Simplex Confirmation */}
      <Modal
        isOpen={isResetConfirmModalOpen}
        onClose={() => !isMutatingReset && setIsResetConfirmModalOpen(false)}
        title="Reset Password in Simplex"
      >
        {selectedUser && (
          <div className="space-y-4 text-xs">
            <p className="text-slate-300 text-sm">
              Reset password for <span className="font-semibold text-white">{selectedUser.username}</span> in{' '}
              <span className="font-semibold text-white">{selectedClient?.clientCode || selectedUser.clientName}</span>?
              This will update the selected Simplex client application.
            </p>
            <p className="text-slate-500 text-[11px]">
              The automation agent will execute the password reset workflow on the target Simplex portal. Any returned temporary password will be displayed once for 60 seconds.
            </p>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                disabled={isMutatingReset}
                onClick={() => setIsResetConfirmModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isMutatingReset}
                onClick={handleResetPasswordExecute}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded font-semibold shadow disabled:opacity-50"
              >
                {isMutatingReset ? 'Resetting in Simplex…' : 'Reset Password in Simplex'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Password Reset One-Time Reveal */}
      <Modal isOpen={isResetModalOpen} onClose={() => setIsResetModalOpen(false)} title={`Password Reset: ${selectedUser?.username}`}>
        <div className="space-y-4 text-xs">
          <div className="p-3 bg-amber-950/60 border border-amber-800 rounded-lg text-amber-200">
            <div className="font-bold flex items-center gap-1.5 mb-1">
              <Shield className="w-4 h-4 text-amber-400" />
              One-Time Temporary Password Security Policy
            </div>
            <p className="text-[11px]">
              This temporary password was generated on the client and delivered once. It is not stored in the database or logs. Copy and provide it securely to the user. They must change it upon first login.
            </p>
          </div>

          {tempPassword ? (
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[10px] uppercase font-semibold">Temporary Password</span>
                <span className="text-amber-400 font-mono text-[11px] flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Auto-clears in {passwordCountdown}s
                </span>
              </div>

              <div className="flex items-center justify-between bg-slate-900 px-3 py-2 rounded border border-slate-700">
                <span className="font-mono text-base tracking-wider text-white">
                  {showPassword ? tempPassword : '••••••••••••'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="p-1 text-slate-400 hover:text-white transition-colors"
                    title={showPassword ? 'Hide' : 'Reveal'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(tempPassword);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-xs font-semibold transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-4 text-slate-500">
              Temporary password has expired and was purged from memory.
            </div>
          )}

          <div className="flex justify-end pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => {
                setIsResetModalOpen(false);
                setTempPassword(null);
              }}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold"
            >
              Close & Clear
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: Excel Import */}
      <Modal isOpen={isImportModalOpen} onClose={() => setIsImportModalOpen(false)} title="Import Users via Excel (.xlsx)">
        <div className="space-y-4 text-xs">
          <div className="flex items-center justify-between bg-slate-950 p-3 rounded-lg border border-slate-800">
            <div>
              <div className="font-semibold text-white">Need the official template?</div>
              <div className="text-slate-500 text-[11px]">Download standard spreadsheet with validation rules</div>
            </div>
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-semibold border border-slate-700 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download Template
            </button>
          </div>

          {/* File Upload Selector */}
          <div>
            <label className="block text-slate-400 mb-1 font-semibold">Select Excel File (.xlsx)</label>
            <input
              type="file"
              accept=".xlsx"
              onChange={handleImportFileChange}
              className="w-full text-xs text-slate-400 file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-sky-600 file:text-white file:font-semibold hover:file:bg-sky-500 cursor-pointer"
            />
          </div>

          {/* Dry Run Preview Grid */}
          {importPreview && (
            <div className="space-y-3 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <div className="font-bold text-white">
                  Dry-Run Preview ({importPreview.totalRows} rows)
                </div>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-emerald-400 font-semibold">{importPreview.readyRows} Ready</span>
                  <span className="text-red-400 font-semibold">{importPreview.errorRows} Warnings/Errors</span>
                </div>
              </div>

              <div className="max-h-60 overflow-y-auto border border-slate-800 rounded bg-slate-950">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-900 text-slate-400 uppercase font-semibold sticky top-0">
                    <tr>
                      <th className="p-2">Row</th>
                      <th className="p-2">Action</th>
                      <th className="p-2">Username</th>
                      <th className="p-2">Full Name</th>
                      <th className="p-2">Status / Classification</th>
                      <th className="p-2">Validation Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {importPreview.rows.map((r) => {
                      const isReady = r.classification.startsWith('READY_');
                      return (
                        <tr key={r.rowNumber} className="hover:bg-slate-900/50">
                          <td className="p-2 font-mono text-slate-500">{r.rowNumber}</td>
                          <td className="p-2 font-semibold text-sky-400">{r.action}</td>
                          <td className="p-2 font-mono text-white">{r.username}</td>
                          <td className="p-2">{r.firstName} {r.lastName}</td>
                          <td className="p-2">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                isReady
                                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                  : r.classification === 'DUPLICATE_USERNAME'
                                  ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                  : 'bg-red-950 text-red-300 border border-red-800'
                              }`}
                            >
                              {r.classification}
                            </span>
                          </td>
                          <td className="p-2 text-slate-400">
                            {r.validationErrors.length > 0 ? (
                              <span className="text-red-400">{r.validationErrors.join('; ')}</span>
                            ) : (
                              <span className="text-emerald-500">Passed dry-run checks</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Execution Summary */}
              {importExecution && (
                <div className="p-3 bg-slate-900 border border-slate-700 rounded-lg space-y-2">
                  <div className="font-bold text-white flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    Import Execution Complete
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="p-2 bg-slate-950 rounded">
                      <span className="block text-slate-500 text-[10px]">Succeeded</span>
                      <span className="text-emerald-400 font-bold">{importExecution.succeededRows}</span>
                    </div>
                    <div className="p-2 bg-slate-950 rounded">
                      <span className="block text-slate-500 text-[10px]">Failed</span>
                      <span className="text-red-400 font-bold">{importExecution.failedRows}</span>
                    </div>
                    <div className="p-2 bg-slate-950 rounded">
                      <span className="block text-slate-500 text-[10px]">Skipped</span>
                      <span className="text-amber-400 font-bold">{importExecution.skippedRows}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsImportModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold"
                >
                  Close
                </button>
                {!importExecution && (
                  <button
                    type="button"
                    disabled={importing || importPreview.readyRows === 0}
                    onClick={handleImportExecute}
                    className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded font-semibold shadow disabled:opacity-50"
                  >
                    {importing ? 'Executing on Client...' : `Confirm Import (${importPreview.readyRows} Ready Rows)`}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
