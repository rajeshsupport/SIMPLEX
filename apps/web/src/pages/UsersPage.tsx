import React, { useEffect, useState, useRef } from 'react';
import {
  Users,
  Plus,
  KeyRound,
  Eye,
  Edit2,
  Power,
  RefreshCw,
  Search,
  Loader2,
  Upload,
  Download,
  AlertTriangle,
  CheckCircle,
  CheckCircle2,
  AlertCircle,
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
  RotateCcw,
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
  ClientCreateFormMetadata,
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
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportMode, setExportMode] = useState<'ALL_USERS' | 'ACTIVE_ONLY'>('ALL_USERS');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [templateDownloadError, setTemplateDownloadError] = useState<string | null>(null);
  const [exportCounts, setExportCounts] = useState<{ total: number; active: number; inactive: number }>({
    total: 0,
    active: 0,
    inactive: 0,
  });

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
    nationality: '',
    role: '',
    profileRole: '',
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

  // Shared Ephemeral Credential Success Modal & FIFO Queue State (Create User, Password Reset & Batch Import)
  interface CredentialSuccessInfo {
    type: 'CREATE' | 'RESET';
    username: string;
    fullName?: string;
    clientCode?: string;
    clientName?: string;
    clientId?: string;
    jobId?: string;
    oneTimeCredentialEventId?: string;
    oneTimeEventIdHash?: string;
    password?: string | null;
    isRestricted?: boolean;
    isUnavailable?: boolean;
    isExpiredBeforeViewing?: boolean;
    hardExpiresAt?: string;
    createdAt?: string;
    roleMappingStatus?: 'COMPLETED' | 'PARTIAL_FAILED' | 'SKIPPED' | 'IN_PROGRESS';
    roleMappingMessage?: string;
  }

  const MAX_CREDENTIAL_QUEUE_SIZE = 10;
  const [credentialQueue, setCredentialQueue] = useState<CredentialSuccessInfo[]>([]);
  const [activeCredential, setActiveCredential] = useState<CredentialSuccessInfo | null>(null);
  const [credentialBatchIndex, setCredentialBatchIndex] = useState<number>(1);
  const [credentialBatchTotal, setCredentialBatchTotal] = useState<number>(1);
  const [isCredentialSuccessModalOpen, setIsCredentialSuccessModalOpen] = useState(false);
  const [credentialPasswordCountdown, setCredentialPasswordCountdown] = useState<number>(60);
  const [isCredentialExpired, setIsCredentialExpired] = useState(false);
  const [copiedCredentialUsername, setCopiedCredentialUsername] = useState(false);
  const [copiedCredentialPassword, setCopiedCredentialPassword] = useState(false);
  const credentialPasswordTimerRef = useRef<NodeJS.Timeout | null>(null);

  const claimAndDisplayCredential = async (item: CredentialSuccessInfo) => {
    if (credentialPasswordTimerRef.current) {
      clearInterval(credentialPasswordTimerRef.current);
      credentialPasswordTimerRef.current = null;
    }
    setCopiedCredentialUsername(false);
    setCopiedCredentialPassword(false);
    setIsCredentialExpired(false);

    if (item.isRestricted) {
      setActiveCredential({ ...item, password: null });
      return;
    }

    if (item.isUnavailable) {
      setActiveCredential({ ...item, password: null });
      return;
    }

    // Check if hard expiry has already passed
    if (item.hardExpiresAt && Date.now() >= new Date(item.hardExpiresAt).getTime()) {
      setActiveCredential({ ...item, password: null, isExpiredBeforeViewing: true });
      setIsCredentialExpired(true);
      return;
    }

    // If password is already present in state
    if (item.password) {
      setActiveCredential(item);
      const remainingHard = item.hardExpiresAt
        ? Math.max(0, Math.floor((new Date(item.hardExpiresAt).getTime() - Date.now()) / 1000))
        : 60;
      const initialCountdown = Math.min(60, remainingHard);
      setCredentialPasswordCountdown(initialCountdown);

      if (initialCountdown <= 0) {
        setIsCredentialExpired(true);
        return;
      }

      credentialPasswordTimerRef.current = setInterval(() => {
        setCredentialPasswordCountdown((prev) => {
          if (prev <= 1) {
            if (credentialPasswordTimerRef.current) {
              clearInterval(credentialPasswordTimerRef.current);
              credentialPasswordTimerRef.current = null;
            }
            setIsCredentialExpired(true);
            setActiveCredential((prevCred) => (prevCred ? { ...prevCred, password: null } : null));
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return;
    }

    // Otherwise, claim from API
    if (item.oneTimeCredentialEventId) {
      try {
        const res = await ApiClient.request<{
          password: string | null;
          hardExpiresAt: string;
          displayDurationSeconds: number;
          credentialDeliveryStatus: string;
        }>('/client-users/claim-ephemeral-credential', {
          method: 'POST',
          body: JSON.stringify({
            oneTimeEventId: item.oneTimeCredentialEventId,
            clientId: item.clientId || selectedClientId,
            jobId: item.jobId,
          }),
        });

        const activeWithSecret: CredentialSuccessInfo = {
          ...item,
          password: res.password,
          hardExpiresAt: res.hardExpiresAt || item.hardExpiresAt,
        };
        setActiveCredential(activeWithSecret);

        const remainingHard = activeWithSecret.hardExpiresAt
          ? Math.max(0, Math.floor((new Date(activeWithSecret.hardExpiresAt).getTime() - Date.now()) / 1000))
          : 60;
        const initialCountdown = Math.min(60, remainingHard);
        setCredentialPasswordCountdown(initialCountdown);

        if (initialCountdown <= 0) {
          setIsCredentialExpired(true);
          return;
        }

        credentialPasswordTimerRef.current = setInterval(() => {
          setCredentialPasswordCountdown((prev) => {
            if (prev <= 1) {
              if (credentialPasswordTimerRef.current) {
                clearInterval(credentialPasswordTimerRef.current);
                credentialPasswordTimerRef.current = null;
              }
              setIsCredentialExpired(true);
              setActiveCredential((prevCred) => (prevCred ? { ...prevCred, password: null } : null));
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } catch (claimErr: any) {
        setActiveCredential({ ...item, password: null, isExpiredBeforeViewing: true });
        setIsCredentialExpired(true);
      }
    } else {
      setActiveCredential({ ...item, password: null, isUnavailable: true });
    }
  };

  const openCredentialSuccessModal = (info: CredentialSuccessInfo | CredentialSuccessInfo[]) => {
    const items = Array.isArray(info) ? info : [info];
    if (items.length === 0) return;

    if (!isCredentialSuccessModalOpen || !activeCredential) {
      const [first, ...rest] = items;
      const boundedRest = rest.slice(0, MAX_CREDENTIAL_QUEUE_SIZE - 1);
      setCredentialQueue(boundedRest);
      setCredentialBatchIndex(1);
      setCredentialBatchTotal(1 + boundedRest.length);
      setIsCredentialSuccessModalOpen(true);
      claimAndDisplayCredential(first);
    } else {
      setCredentialQueue((prev) => {
        const availableSlots = Math.max(0, MAX_CREDENTIAL_QUEUE_SIZE - prev.length);
        const boundedNew = items.slice(0, availableSlots);
        return [...prev, ...boundedNew];
      });
      setCredentialBatchTotal((prev) => prev + items.length);
    }
  };

  const handleNextOrCloseCredentialModal = async () => {
    if (credentialPasswordTimerRef.current) {
      clearInterval(credentialPasswordTimerRef.current);
      credentialPasswordTimerRef.current = null;
    }

    if (activeCredential?.oneTimeCredentialEventId || activeCredential?.oneTimeEventIdHash) {
      ApiClient.request('/client-users/ack-ephemeral-credential', {
        method: 'POST',
        body: JSON.stringify({
          oneTimeEventId: activeCredential.oneTimeCredentialEventId,
          oneTimeEventIdHash: activeCredential.oneTimeEventIdHash,
          status: 'DISMISSED',
        }),
      }).catch(() => {});
    }

    if (credentialQueue.length > 0) {
      const [next, ...rest] = credentialQueue;
      setCredentialQueue(rest);
      setCredentialBatchIndex((prev) => prev + 1);
      await claimAndDisplayCredential(next);
    } else {
      setActiveCredential(null);
      setCredentialQueue([]);
      setIsCredentialSuccessModalOpen(false);
      setIsCredentialExpired(false);
      setCopiedCredentialUsername(false);
      setCopiedCredentialPassword(false);
      await loadUsers();
    }
  };

  const closeCredentialSuccessModal = async () => {
    if (credentialPasswordTimerRef.current) {
      clearInterval(credentialPasswordTimerRef.current);
      credentialPasswordTimerRef.current = null;
    }

    if (activeCredential?.oneTimeCredentialEventId || activeCredential?.oneTimeEventIdHash) {
      ApiClient.request('/client-users/ack-ephemeral-credential', {
        method: 'POST',
        body: JSON.stringify({
          oneTimeEventId: activeCredential.oneTimeCredentialEventId,
          oneTimeEventIdHash: activeCredential.oneTimeEventIdHash,
          status: 'DISMISSED',
        }),
      }).catch(() => {});
    }

    setActiveCredential(null);
    setCredentialQueue([]);
    setIsCredentialSuccessModalOpen(false);
    setIsCredentialExpired(false);
    setCopiedCredentialUsername(false);
    setCopiedCredentialPassword(false);
    await loadUsers();
  };

  // Excel Import state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ExcelUserImportPreviewResult | null>(null);
  const [importExecution, setImportExecution] = useState<ExcelUserImportExecutionSummary | null>(null);
  const [importing, setImporting] = useState(false);

  const { hasPermission, isSuperAdmin } = useAuth();
  const [agentStatus, setAgentStatus] = useState<'ONLINE' | 'OFFLINE' | 'BUSY'>('OFFLINE');
  const [isAgentOnline, setIsAgentOnline] = useState<boolean>(false);

  // Status mutation progress / modal state
  const [isMutatingStatus, setIsMutatingStatus] = useState(false);
  const [statusMutationStage, setStatusMutationStage] = useState<string>('');
  const [statusMutationElapsed, setStatusMutationElapsed] = useState<number>(0);
  const [statusMutationError, setStatusMutationError] = useState<string | null>(null);
  const [statusMutationSuccess, setStatusMutationSuccess] = useState<string | null>(null);
  const statusMutationTimerRef = useRef<any>(null);

  // Clean up ephemeral credentials on client switch
  useEffect(() => {
    if (credentialPasswordTimerRef.current) {
      clearInterval(credentialPasswordTimerRef.current);
      credentialPasswordTimerRef.current = null;
    }
    setActiveCredential(null);
    setCredentialQueue([]);
    setIsCredentialSuccessModalOpen(false);
  }, [selectedClientId]);

  // Clean up ephemeral credentials and intervals on unmount and beforeunload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (activeCredential?.oneTimeCredentialEventId) {
        navigator.sendBeacon?.(
          '/api/client-users/ack-ephemeral-credential',
          JSON.stringify({ oneTimeEventId: activeCredential.oneTimeCredentialEventId, status: 'DISMISSED' })
        );
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (credentialPasswordTimerRef.current) clearInterval(credentialPasswordTimerRef.current);
      if (statusMutationTimerRef.current) clearInterval(statusMutationTimerRef.current);
      setActiveCredential(null);
      setCredentialQueue([]);
    };
  }, []);

  // Check agent status with 3s polling
  useEffect(() => {
    let isMounted = true;
    const checkAgent = async () => {
      try {
        const agents = await ApiClient.request<any[]>('/agents');
        if (!isMounted) return;
        if (!agents || agents.length === 0) {
          setAgentStatus('OFFLINE');
          setIsAgentOnline(false);
          return;
        }
        const hasBusy = agents.some((a) => a.status === 'BUSY');
        const hasOnline = agents.some((a) => a.status === 'ONLINE');
        if (hasBusy) {
          setAgentStatus('BUSY');
          setIsAgentOnline(true);
        } else if (hasOnline) {
          setAgentStatus('ONLINE');
          setIsAgentOnline(true);
        } else {
          setAgentStatus('OFFLINE');
          setIsAgentOnline(false);
        }
      } catch {
        if (isMounted) {
          setAgentStatus('OFFLINE');
          setIsAgentOnline(false);
        }
      }
    };
    checkAgent();
    const interval = setInterval(checkAgent, 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const isProduction = selectedClient?.environment?.toUpperCase() === 'PRODUCTION';

  const canCreate = isSuperAdmin || hasPermission(PERMISSIONS.CLIENT_USERS_CREATE);
  const canEdit = isSuperAdmin || hasPermission(PERMISSIONS.CLIENT_USERS_EDIT);
  const canChangeStatus = isSuperAdmin || hasPermission(PERMISSIONS.CLIENT_USERS_STATUS_CHANGE);
  const canResetPassword = isSuperAdmin || hasPermission(PERMISSIONS.CLIENT_USER_PASSWORD_RESET);
  const canImport = isSuperAdmin || hasPermission(PERMISSIONS.CLIENT_USERS_IMPORT);
  const canExport = isSuperAdmin || hasPermission(PERMISSIONS.CLIENT_USERS_EXPORT);

  const getMutationState = (baseTitle: string, user?: ClientUser): { title: string; disabled: boolean } => {
    if (user && user.isPresentRemotely === false) {
      return { title: 'REMOTE_USER_NOT_PRESENT — Refresh the selected client directory.', disabled: true };
    }
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

  const [formMetadata, setFormMetadata] = useState<ClientCreateFormMetadata | null>(null);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsSyncTime, setOptionsSyncTime] = useState<string | null>(null);
  const [isConfirmingCreate, setIsConfirmingCreate] = useState(false);
  const reqIdRef = useRef<number>(0);

  const loadFormOptions = async (clientId: string, forceRefresh: boolean = false) => {
    if (!clientId) return;
    setIsLoadingOptions(true);
    setOptionsError(null);
    try {
      const url = `/client-users/form-options?clientId=${encodeURIComponent(clientId)}${forceRefresh ? '&refresh=true' : ''}`;
      const meta = await ApiClient.request<ClientCreateFormMetadata>(url);
      setFormMetadata(meta);
      setOptionsSyncTime(new Date().toLocaleTimeString());
      if (meta && meta.nationalities && meta.nationalities.length > 0) {
        const defaultNat = typeof meta.nationalities[0] === 'string' ? meta.nationalities[0] : (meta.nationalities[0].value || meta.nationalities[0].label);
        const defaultRole = meta.roles && meta.roles.length > 0 ? (typeof meta.roles[0] === 'string' ? meta.roles[0] : (meta.roles[0].value || meta.roles[0].label)) : '';
        let matchingProf = '';
        if (defaultRole && meta.profileRoles) {
          const match = meta.profileRoles.find(
            (p: any) => !p.roleDependency || p.roleDependency.toLowerCase() === defaultRole.toLowerCase()
          );
          if (match) matchingProf = typeof match === 'string' ? match : (match.value || match.label);
        }
        setCreateForm((prev) => ({
          ...prev,
          nationality: prev.nationality || defaultNat || '',
          role: prev.role || defaultRole || '',
          profileRole: prev.profileRole || matchingProf || '',
        }));
      }
    } catch (err: any) {
      const errCode = err.response?.code || err.code;
      const errMsg = err.response?.message || err.message;
      setFormMetadata(null);
      setOptionsError(errCode === 'FORM_OPTIONS_UNAVAILABLE' ? 'FORM_OPTIONS_UNAVAILABLE' : (errMsg || 'FORM_OPTIONS_UNAVAILABLE'));
    } finally {
      setIsLoadingOptions(false);
    }
  };

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
      const rawUsers = res.users || [];
      const seen = new Set<string>();
      const dedupedUsers: ClientUser[] = [];
      for (const u of rawUsers) {
        const key = `${u.clientId || selectedClientId}:${(u.remoteUserId || u.username || '').toLowerCase().trim()}`;
        if (!seen.has(key)) {
          seen.add(key);
          dedupedUsers.push(u);
        }
      }
      setUsers(dedupedUsers);
      setTotalCount(res.totalCount !== undefined ? res.totalCount : dedupedUsers.length);
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
    setFormMetadata(null);
    setOptionsError(null);
    setOptionsSyncTime(null);
    setCreateForm({
      clientId: selectedClientId,
      username: '',
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
    await loadFormOptions(selectedClientId);
  };

  // Reconcile user state with remote Simplex via read-only sync
  const [isReconciling, setIsReconciling] = useState(false);
  const handleReconcileUser = async (targetUsername?: string) => {
    const uname = (targetUsername || createForm.username || '').trim();
    if (!selectedClientId || !uname) return;
    setIsReconciling(true);
    try {
      const res = await ApiClient.request<ClientUser>('/client-users/reconcile', {
        method: 'POST',
        body: JSON.stringify({ clientId: selectedClientId, username: uname }),
      });
      setIsCreateModalOpen(false);
      setCreateError(null);
      setPotentialDuplicate(null);
      setIsConfirmingCreate(false);
      setActionMessage({ type: 'success', text: `✓ ${res.message || `User '${uname}' reconciled and verified successfully.`}` });
      await loadUsers();
    } catch (err: any) {
      setCreateError(err.message || `Could not reconcile user '${uname}'.`);
    } finally {
      setIsReconciling(false);
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
      setCreateError(null);
      setPotentialDuplicate(null);

      // Setup Post-Create Shared Credential Success Modal
      const isRestricted = (res as any).credentialDeliveryStatus === 'RESTRICTED';
      const isUnavailable = (res as any).credentialDeliveryStatus === 'UNAVAILABLE' || (res as any).credentialDeliveryStatus === 'FAILED';

      openCredentialSuccessModal({
        type: 'CREATE',
        username: res.username,
        fullName: res.fullName,
        clientCode: selectedClient?.clientCode,
        clientName: selectedClient?.clientName,
        clientId: selectedClientId,
        oneTimeCredentialEventId: (res as any).oneTimeCredentialEventId,
        isRestricted,
        isUnavailable,
      });

      // Reset form state for next creation
      setCreateForm({
        clientId: selectedClientId,
        username: '',
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
        signatureBase64: '',
        signatureFilename: '',
        stampBase64: '',
        stampFilename: '',
        profileBase64: '',
        profileFilename: '',
        status: 'ACTIVE',
        overrideDuplicateName: false,
      });

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
      } else if (code === 'CLIENT_AUTO_LOGIN_FAILED') {
        setCreateError(msg || 'Automatic authentication to client portal failed. Please verify stored client credentials.');
      } else if (code === 'REMOTE_ADD_USER_ROUTE_FAILED') {
        setCreateError(msg || 'Remote Add User screen route could not be opened or rendered.');
      } else if (code === 'REMOTE_FORM_NOT_READY' || code === 'REMOTE_ADD_USER_FORM_NOT_READY') {
        setCreateError(msg || 'Remote Add User form did not render or become ready within timeout.');
      } else if (code === 'REMOTE_REQUIRED_FIELD_NOT_FOUND' || code === 'REMOTE_FORM_FIELD_NOT_FOUND') {
        setCreateError(msg || 'A required field was not found on the live Simplex form.');
      } else if (code === 'REMOTE_SUBMIT_BUTTON_NOT_FOUND') {
        setCreateError(msg || 'Submit button (Save/Add/Create/Submit/Update) not found on remote Add User form.');
      } else if (code === 'REMOTE_SUBMIT_BUTTON_DISABLED') {
        setCreateError(msg || 'Remote Save button is disabled (form validation may be incomplete).');
      } else if (code === 'REMOTE_CONFIRMATION_NOT_COMPLETED') {
        setCreateError(msg || 'Remote confirmation dialog or modal could not be completed.');
      } else if (code === 'REMOTE_SAVE_REJECTED' || code === 'REMOTE_VALIDATION_FAILED') {
        setCreateError(msg || 'Remote Add User form submission was rejected by the client.');
      } else if (code === 'REMOTE_CREATE_VERIFICATION_FAILED' || code === 'REMOTE_USER_NOT_FOUND_AFTER_CREATE') {
        setCreateError(msg || `User '${createForm.username}' was not found on the remote user list after creation.`);
      } else if (code === 'REMOTE_DROPDOWN_OPTION_NOT_FOUND') {
        setCreateError(msg || 'Selected dropdown option not found on the live Simplex form.');
      } else if (code === 'REMOTE_FORM_VALIDATION_FAILED' || code === 'REMOTE_FORM_VALUE_MISMATCH') {
        setCreateError('Form value mismatch during pre-submission read-back verification.');
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
  const handleStatusChange = async () => {
    if (!selectedUser || isMutatingStatus) return;

    // Preflight Check: Automation Agent must be online
    if (!isAgentOnline) {
      setStatusMutationError('Automation Agent is offline. Start/reconnect the agent and retry.');
      return;
    }

    // Preflight Check: User must be present remotely
    if (selectedUser.isPresentRemotely === false) {
      setStatusMutationError('REMOTE_USER_NOT_PRESENT — Refresh the selected client directory.');
      return;
    }

    const nextStatus = selectedUser.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setIsMutatingStatus(true);
    setStatusMutationError(null);
    setStatusMutationSuccess(null);
    setStatusMutationStage('Preflight: Checking automation agent…');
    setStatusMutationElapsed(0);

    if (statusMutationTimerRef.current) clearInterval(statusMutationTimerRef.current);
    statusMutationTimerRef.current = setInterval(() => {
      setStatusMutationElapsed((prev) => prev + 1);
    }, 1000);

    try {
      setStatusMutationStage(`Submitting ${nextStatus} request to Simplex portal…`);
      await ApiClient.request(`/client-users/${selectedUser.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: nextStatus }),
      });

      setStatusMutationStage('Remote status verified. Synchronizing Central directory…');
      setStatusMutationSuccess(`✓ User '${selectedUser.username}' status updated to ${nextStatus} in ${selectedClient?.clientCode || 'Simplex'}.`);

      if (statusMutationTimerRef.current) {
        clearInterval(statusMutationTimerRef.current);
        statusMutationTimerRef.current = null;
      }

      await loadUsers();

      // Auto-close modal after 500ms on verified success
      setTimeout(() => {
        setIsStatusModalOpen(false);
        setStatusMutationSuccess(null);
        setStatusMutationStage('');
        setActionMessage({
          type: 'success',
          text: `✓ User '${selectedUser.username}' status updated to ${nextStatus} in ${selectedClient?.clientCode || 'Simplex'}.`,
        });
      }, 500);
    } catch (err: any) {
      if (statusMutationTimerRef.current) {
        clearInterval(statusMutationTimerRef.current);
        statusMutationTimerRef.current = null;
      }
      const rawCode = err.code || err.errorCode || err.response?.code;
      const rawMsg = err.message || '';
      if (rawCode === 'DESKTOP_AGENT_OFFLINE' || rawMsg.toLowerCase().includes('offline')) {
        setStatusMutationError('Automation Agent is offline. Start/reconnect the agent and retry.');
      } else if (rawCode === 'REMOTE_USER_NOT_PRESENT' || rawMsg.includes('REMOTE_USER_NOT_PRESENT')) {
        setStatusMutationError('REMOTE_USER_NOT_PRESENT — Refresh the selected client directory.');
      } else {
        const cleanError = rawMsg.replace(/^Status update failed:\s*/i, '').replace(/^Sync failed:\s*/i, '') || 'Status update failed';
        setStatusMutationError(`Status update failed: ${cleanError}`);
      }
    } finally {
      setIsMutatingStatus(false);
      if (statusMutationTimerRef.current) {
        clearInterval(statusMutationTimerRef.current);
        statusMutationTimerRef.current = null;
      }
    }
  };

  const handleCloseStatusModal = () => {
    if (isMutatingStatus) return;
    if (statusMutationTimerRef.current) {
      clearInterval(statusMutationTimerRef.current);
      statusMutationTimerRef.current = null;
    }
    setIsStatusModalOpen(false);
    setStatusMutationError(null);
    setStatusMutationSuccess(null);
    setStatusMutationStage('');
    setStatusMutationElapsed(0);
  };

  // Password Reset in Simplex
  const [isResetConfirmModalOpen, setIsResetConfirmModalOpen] = useState(false);
  const [isMutatingReset, setIsMutatingReset] = useState(false);
  const handleResetPasswordExecute = async () => {
    if (!selectedUser || isMutatingReset) return;
    setIsMutatingReset(true);
    try {
      const res = await ApiClient.request<{
        success: boolean;
        credentialDeliveryStatus?: string;
        oneTimeCredentialEventId?: string;
        message: string;
        username?: string;
      }>(`/client-users/${selectedUser.id}/reset-password`, { method: 'POST' });
      setIsResetConfirmModalOpen(false);
      const isRestricted = res.credentialDeliveryStatus === 'RESTRICTED';
      const isUnavailable = res.credentialDeliveryStatus === 'UNAVAILABLE' || res.credentialDeliveryStatus === 'FAILED';
      openCredentialSuccessModal({
        type: 'RESET',
        username: res.username || selectedUser.username,
        clientCode: selectedClient?.clientCode,
        clientName: selectedClient?.clientName,
        oneTimeCredentialEventId: res.oneTimeCredentialEventId,
        isRestricted,
        isUnavailable,
      });
    } catch (err: any) {
      setIsResetConfirmModalOpen(false);
      const cleanError = (err.message || 'Password reset failed').replace(/^Sync failed:\s*/i, '');
      setActionMessage({ type: 'error', text: `Password reset failed: ${cleanError}` });
    } finally {
      setIsMutatingReset(false);
    }
  };

  // Excel Export Current Users Modal Handlers
  const handleOpenExportModal = async () => {
    if (!selectedClientId) {
      setActionMessage({ type: 'error', text: 'Please select a client first.' });
      return;
    }
    setExportMode('ALL_USERS');
    setExportError(null);
    setIsExportModalOpen(true);

    try {
      const res = await ApiClient.request<ClientUserListResponse>(
        `/client-users?clientId=${encodeURIComponent(selectedClientId)}&page=1&limit=1`
      );
      const total = res.totalCount ?? 0;
      const active = res.activeCount ?? 0;
      const inactive = res.inactiveCount ?? (total >= active ? total - active : 0);
      setExportCounts({
        total,
        active,
        inactive,
      });
    } catch {
      const active = users.filter((u) => u.status === 'ACTIVE').length;
      const inactive = users.filter((u) => u.status === 'INACTIVE').length;
      setExportCounts({
        total: totalCount || active + inactive,
        active,
        inactive: totalCount && totalCount >= active ? totalCount - active : inactive,
      });
    }
  };

  const handleExecuteExport = async () => {
    if (!selectedClientId || isExporting) return;
    setIsExporting(true);
    setExportError(null);

    try {
      const res = await fetch(
        `/api/v1/client-users/export-excel?clientId=${encodeURIComponent(selectedClientId)}&mode=${exportMode}`,
        {
          headers: {
            Authorization: `Bearer ${ApiClient.getAccessToken()}`,
          },
        }
      );

      if (!res.ok) {
        let errMessage = 'Failed to generate export file.';
        try {
          const errJson = await res.json();
          if (errJson.message) errMessage = errJson.message;
        } catch {}
        throw new Error(errMessage);
      }

      let filename = `${selectedClient?.clientCode || 'client'}_${exportMode === 'ACTIVE_ONLY' ? 'Active_Users' : 'All_Users'}_${Date.now()}.xlsx`;
      const disposition = res.headers.get('Content-Disposition');
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename="?([^";]+)"?/);
        if (match && match[1]) filename = match[1];
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      setIsExportModalOpen(false);
      setActionMessage({
        type: 'success',
        text: `✓ Successfully exported ${filename}`,
      });
    } catch (err: any) {
      setExportError(err.message || 'Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  // Dynamic Excel Import Template (scoped by selected client's live form options)
  const handleDownloadTemplate = async () => {
    if (!selectedClientId) {
      setActionMessage({ type: 'error', text: 'Please select a client first.' });
      return;
    }
    if (optionsError === 'FORM_OPTIONS_UNAVAILABLE') {
      setActionMessage({
        type: 'error',
        text: 'FORM_OPTIONS_UNAVAILABLE: Live form options could not be synchronized from this client.',
      });
      setTemplateDownloadError('FORM_OPTIONS_UNAVAILABLE: Live form options could not be synchronized.');
      return;
    }

    setIsDownloadingTemplate(true);
    setTemplateDownloadError(null);

    try {
      const { blob, filename } = await ApiClient.downloadBlob(
        `/client-users/import-template?clientId=${encodeURIComponent(selectedClientId)}`
      );

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `${selectedClient?.clientCode || 'Client'}_User_Import_Template.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setActionMessage({
        type: 'success',
        text: 'Sample Excel downloaded successfully',
      });
    } catch (err: any) {
      const msg = err.message || 'Failed to download sample document.';
      if (msg.includes('SESSION_EXPIRED') || msg.includes('401')) {
        setActionMessage({
          type: 'error',
          text: 'SESSION_EXPIRED — Please sign in again.',
        });
        setTemplateDownloadError('SESSION_EXPIRED — Please sign in again.');
      } else {
        setActionMessage({
          type: 'error',
          text: msg,
        });
        setTemplateDownloadError(msg);
      }
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  // Export Import Execution Results
  const handleExportImportResults = async () => {
    if (!importExecution || !selectedClientId) return;
    try {
      const res = await fetch(`/api/v1/client-users/export-import-results`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ApiClient.getAccessToken()}`,
        },
        body: JSON.stringify({
          clientId: selectedClientId,
          summary: importExecution,
        }),
      });
      if (!res.ok) throw new Error('Failed to export import results');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `user_import_results_${importExecution.jobId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: `Export results failed: ${err.message}` });
    }
  };

  // Toggle Row Approval in Dry-Run Preview
  const toggleRowApproval = (rowNumber: number) => {
    if (!importPreview) return;
    setImportPreview({
      ...importPreview,
      rows: importPreview.rows.map((r) =>
        r.rowNumber === rowNumber ? { ...r, isApproved: !r.isApproved } : r
      ),
    });
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

  // Excel Import Execution State
  const [importProgress, setImportProgress] = useState<{
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
    skipped: number;
    currentUsername?: string;
  }>({ total: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0 });
  const [isImportPaused, setIsImportPaused] = useState(false);
  const [isImportCancelled, setIsImportCancelled] = useState(false);
  const isImportPausedRef = useRef(false);
  const isImportCancelledRef = useRef(false);

  // Excel Import Execute with Pause, Resume, and Cancel support
  const handleImportExecute = async () => {
    if (!importPreview || !selectedClientId) return;
    if (isProduction) {
      setActionMessage({ type: 'error', text: 'Bulk mutations on PRODUCTION clients are strictly prohibited.' });
      return;
    }

    setImporting(true);
    setIsImportPaused(false);
    setIsImportCancelled(false);
    isImportPausedRef.current = false;
    isImportCancelledRef.current = false;

    const allRows = importPreview.rows;
    setImportProgress({
      total: allRows.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    });

    try {
      const res = await ApiClient.request<ExcelUserImportExecutionSummary>('/client-users/import-execute', {
        method: 'POST',
        body: JSON.stringify({
          clientId: selectedClientId,
          rows: allRows,
        }),
      });

      setImportExecution(res);
      setImportProgress({
        total: res.totalRows,
        processed: res.totalRows,
        succeeded: res.createdRows ?? res.succeededRows,
        failed: res.failedRows,
        skipped: (res.alreadyExistingRows ?? 0) + (res.notProcessedRows ?? 0),
      });

      setActionMessage({
        type: 'success',
        text: `✓ Import complete: ${res.createdRows ?? res.succeededRows} created, ${res.alreadyExistingRows ?? 0} already existing, ${res.invalidRows ?? 0} invalid, ${res.failedRows} failed, ${res.notProcessedRows ?? 0} not processed.`,
      });

      // Enqueue ephemeral credentials from batch import into FIFO queue
      if (res.ephemeralCredentials && res.ephemeralCredentials.length > 0) {
        const credsToQueue: CredentialSuccessInfo[] = res.ephemeralCredentials.map((c) => ({
          type: 'CREATE',
          username: c.username,
          fullName: c.fullName,
          clientCode: selectedClient?.clientCode,
          clientName: selectedClient?.clientName,
          clientId: c.clientId || selectedClientId,
          jobId: c.jobId,
          oneTimeCredentialEventId: c.oneTimeEventId,
          oneTimeEventIdHash: c.oneTimeEventIdHash,
          isRestricted: c.credentialDeliveryStatus === 'RESTRICTED',
          isUnavailable: c.credentialDeliveryStatus === 'UNAVAILABLE' || c.credentialDeliveryStatus === 'FAILED',
          hardExpiresAt: c.hardExpiresAt,
          createdAt: c.createdAt,
        }));
        openCredentialSuccessModal(credsToQueue);
      }

      await loadUsers();
    } catch (err: any) {
      const msg = err.message || err.response?.message || 'Import execution failed';
      setActionMessage({ type: 'error', text: `Import execution failed: ${msg}` });
      alert(`Import execution failed: ${msg}`);
    } finally {
      setImporting(false);
    }
  };

  // Retry Failed Rows Only (resumes from role mapping or user creation as appropriate)
  const handleRetryFailedRows = async () => {
    if (!importExecution || !selectedClientId || !importPreview) return;
    const retryableResults = importExecution.results.filter(
      (r) => r.result === 'FAILED' || r.result === 'PARTIAL_FAILED' || r.overallStatus === 'FAILED' || r.overallStatus === 'PARTIAL_FAILED'
    );
    if (retryableResults.length === 0) return;

    const retryMap = new Map(retryableResults.map((f) => [f.username.toLowerCase(), f]));
    const retryRows = importPreview.rows
      .filter((r) => retryMap.has(r.username.toLowerCase()))
      .map((r) => {
        const res = retryMap.get(r.username.toLowerCase());
        const startingPoint = res?.retryStartingPoint || (res?.result === 'PARTIAL_FAILED' || res?.overallStatus === 'PARTIAL_FAILED' ? 'ROLE_MAPPING' : 'USER_CREATION');
        return {
          ...r,
          retryStartingPoint: startingPoint,
        };
      });

    setImporting(true);
    try {
      const res = await ApiClient.request<ExcelUserImportExecutionSummary>('/client-users/import-execute', {
        method: 'POST',
        body: JSON.stringify({
          clientId: selectedClientId,
          rows: retryRows,
        }),
      });

      // Enqueue ephemeral credentials from retry import if newly created
      if (res.ephemeralCredentials && res.ephemeralCredentials.length > 0) {
        const credsToQueue: CredentialSuccessInfo[] = res.ephemeralCredentials.map((c) => ({
          type: 'CREATE',
          username: c.username,
          fullName: c.fullName,
          clientCode: selectedClient?.clientCode,
          clientName: selectedClient?.clientName,
          clientId: c.clientId || selectedClientId,
          jobId: c.jobId,
          oneTimeCredentialEventId: c.oneTimeEventId,
          oneTimeEventIdHash: c.oneTimeEventIdHash,
          isRestricted: c.credentialDeliveryStatus === 'RESTRICTED',
          isUnavailable: c.credentialDeliveryStatus === 'UNAVAILABLE' || c.credentialDeliveryStatus === 'FAILED',
          hardExpiresAt: c.hardExpiresAt,
          createdAt: c.createdAt,
        }));
        openCredentialSuccessModal(credsToQueue);
      }

      // Merge retry results with original execution summary
      const updatedResults = [
        ...importExecution.results.filter((r) => !retryMap.has(r.username.toLowerCase())),
        ...res.results,
      ];
      const mergedSummary: ExcelUserImportExecutionSummary = {
        jobId: importExecution.jobId,
        totalRows: updatedResults.length,
        completedRows: updatedResults.filter((r) => r.overallStatus === 'COMPLETED' && r.result !== 'ALREADY_EXISTS').length,
        failedBeforeCreationRows: updatedResults.filter((r) => r.creationState === 'FAILED' || (r.overallStatus === 'FAILED' && r.result === 'FAILED')).length,
        userCreatedRolePendingRows: updatedResults.filter((r) => r.overallStatus === 'PARTIAL_FAILED' || r.result === 'PARTIAL_FAILED').length,
        alreadyExistingRows: updatedResults.filter((r) => r.result === 'ALREADY_EXISTS').length,
        invalidRows: updatedResults.filter((r) => r.result === 'INVALID' || r.result === 'VALIDATION_FAILED').length,
        failedRows: updatedResults.filter((r) => r.result === 'FAILED' || r.result === 'PARTIAL_FAILED' || r.result === 'REMOTE_ERROR').length,
        cancelledRows: updatedResults.filter((r) => r.result === 'CANCELLED').length,
        notProcessedRows: updatedResults.filter((r) => r.result === 'NOT_PROCESSED' || r.result === 'SKIPPED_DUPLICATE').length,
        succeededRows: updatedResults.filter((r) => r.overallStatus === 'COMPLETED' && r.result !== 'ALREADY_EXISTS').length,
        skippedRows: updatedResults.filter((r) => r.result === 'ALREADY_EXISTS' || r.result === 'NOT_PROCESSED' || r.result === 'CANCELLED').length,
        createdRows: updatedResults.filter((r) => r.result === 'SUCCESS' || r.result === 'CREATED' || r.creationState === 'COMPLETED').length,
        batchStatus: res.batchStatus,
        results: updatedResults,
      };

      setImportExecution(mergedSummary);
      setActionMessage({
        type: 'success',
        text: `✓ Retry complete: ${res.completedRows ?? res.succeededRows} completed, ${res.failedBeforeCreationRows ?? 0} failed before creation, ${res.userCreatedRolePendingRows ?? 0} role mapping pending.`,
      });
      await loadUsers();
    } catch (err: any) {
      alert(`Retry execution failed: ${err.message}`);
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

            <div className="text-right">
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Automation Agent</span>
              <div className="flex items-center gap-1.5 justify-end">
                <span
                  className={`w-2 h-2 rounded-full ${
                    agentStatus === 'ONLINE'
                      ? 'bg-emerald-400'
                      : agentStatus === 'BUSY'
                      ? 'bg-amber-400 animate-pulse'
                      : 'bg-red-400'
                  }`}
                />
                <span className="text-slate-300 font-mono text-xs font-semibold">
                  {agentStatus}
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

        <div className="flex flex-wrap items-center gap-2">
          {canImport && (
            <button
              onClick={handleDownloadTemplate}
              disabled={!selectedClientId || isDownloadingTemplate}
              title={
                optionsError === 'FORM_OPTIONS_UNAVAILABLE'
                  ? 'FORM_OPTIONS_UNAVAILABLE: Live form options unavailable'
                  : 'Download dynamic Excel template with live client dropdown options'
              }
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-colors border border-slate-700 disabled:opacity-50"
            >
              {isDownloadingTemplate ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                  Preparing Sample…
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                  Download Template
                </>
              )}
            </button>
          )}

          {canImport && (
            <button
              onClick={() => setIsImportModalOpen(true)}
              disabled={!selectedClientId || isProduction}
              title={isProduction ? 'Bulk user import is disabled on PRODUCTION.' : 'Import users from Excel workbook'}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-colors border border-slate-700 disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5 text-sky-400" />
              Import Users
            </button>
          )}

          {canExport && (
            <button
              onClick={handleOpenExportModal}
              disabled={!selectedClientId}
              title="Export current verified user directory snapshot for the selected client"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-colors border border-slate-700 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5 text-sky-400" />
              Export Current Users
            </button>
          )}

          {canExport && importExecution && (
            <button
              onClick={handleExportImportResults}
              title="Export execution results of the latest bulk import job"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-colors border border-emerald-800/80 text-emerald-300"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              Export Import Results
            </button>
          )}

          {canCreate && (
            <button
              disabled={isProduction}
              title={isProduction ? 'Production mutation requires separate authorization.' : 'Create User'}
              onClick={handleOpenCreateModal}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold shadow transition-colors disabled:opacity-50"
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
                            const mutation = getMutationState('Edit & Update Client', u);
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
                            const mutation = getMutationState(actionLabel, u);
                            const isThisUserMutating = isMutatingStatus && selectedUser?.id === u.id;
                            return (
                              <button
                                disabled={mutation.disabled || isMutatingStatus}
                                onClick={() => {
                                  if (mutation.disabled || isMutatingStatus) return;
                                  setSelectedUser(u);
                                  setStatusMutationError(null);
                                  setStatusMutationSuccess(null);
                                  setStatusMutationStage('');
                                  setStatusMutationElapsed(0);
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
                                {isThisUserMutating ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Power className="w-3.5 h-3.5" />
                                )}
                              </button>
                            );
                          })()}

                          {/* Reset Password in Simplex */}
                          {canResetPassword && (() => {
                            const mutation = getMutationState('Reset Password in Simplex', u);
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
          {/* Options Synchronization Toolbar */}
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Target Client: <strong className="text-white">{selectedClient?.clientCode}</strong> ({selectedClient?.applicationVersion || 'v9.4'})</span>
            </div>
            <div className="flex items-center gap-3">
              {optionsSyncTime && !isLoadingOptions && !optionsError && (
                <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Options synchronized at {optionsSyncTime}
                </span>
              )}
              <button
                type="button"
                disabled={isLoadingOptions}
                onClick={() => loadFormOptions(selectedClientId, true)}
                className="text-[11px] text-sky-400 hover:text-sky-300 disabled:opacity-50 flex items-center gap-1 font-medium transition-colors"
                title="Reload live options directly from Simplex Add User page"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingOptions ? 'animate-spin' : ''}`} />
                Refresh Options
              </button>
            </div>
          </div>

          {/* Loading Options Banner */}
          {isLoadingOptions && (
            <div className="p-3 bg-sky-950/70 border border-sky-800/80 rounded-lg text-sky-200 flex items-center gap-2.5">
              <Loader2 className="w-4 h-4 animate-spin text-sky-400 flex-shrink-0" />
              <span>Loading client options from live Add User screen…</span>
            </div>
          )}

          {/* Options Error Banner */}
          {optionsError && !isLoadingOptions && (
            <div className="p-3 bg-red-950/80 border border-red-800 rounded-lg text-red-200 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span>FORM_OPTIONS_UNAVAILABLE</span>
                </div>
                <button
                  type="button"
                  onClick={() => loadFormOptions(selectedClientId, true)}
                  className="px-2.5 py-1 bg-red-800 hover:bg-red-700 text-white rounded text-[11px] font-semibold flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  Retry
                </button>
              </div>
              <p className="text-[11px] text-red-300">
                Could not load live dropdown options from Simplex client. Submission is disabled until options are successfully synchronized.
              </p>
            </div>
          )}

          {createError && (
            <div className="p-3 bg-red-950/80 border border-red-800 rounded-lg text-red-200">
              <div className="flex items-center justify-between mb-1">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  {potentialDuplicate ? 'Validation Warning' : 'Creation Error'}
                </div>
                {createForm.username && (
                  <button
                    type="button"
                    disabled={isReconciling}
                    onClick={() => handleReconcileUser(createForm.username)}
                    className="px-2.5 py-1 bg-sky-800 hover:bg-sky-700 disabled:opacity-50 text-white rounded text-[11px] font-semibold flex items-center gap-1 shadow transition-colors"
                    title="Check and synchronize if user was already created remotely on Simplex"
                  >
                    <RefreshCw className={`w-3 h-3 ${isReconciling ? 'animate-spin' : ''}`} />
                    Refresh Verification
                  </button>
                )}
              </div>
              <p className="text-[11px] text-red-300">{createError}</p>

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

          <div className="grid grid-cols-2 gap-3">
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

          {/* Live Dropdowns Scoped by Client */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Nationality *</label>
              <select
                required
                disabled={isLoadingOptions || !!optionsError || !formMetadata}
                value={createForm.nationality}
                onChange={(e) => setCreateForm({ ...createForm, nationality: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">{isLoadingOptions ? 'Loading nationalities…' : '-- Select Nationality --'}</option>
                {formMetadata?.nationalities?.map((n: any) => {
                  const val = typeof n === 'string' ? n : (n?.value || n?.label || '');
                  const lbl = typeof n === 'string' ? n : (n?.label || n?.value || '');
                  return (
                    <option key={val} value={val}>
                      {lbl}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Role</label>
              <select
                disabled={isLoadingOptions || !!optionsError || !formMetadata}
                value={createForm.role}
                onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">{isLoadingOptions ? 'Loading roles…' : '-- Select Role --'}</option>
                {formMetadata?.roles?.map((r: any) => {
                  const val = typeof r === 'string' ? r : (r?.value || r?.label || '');
                  const lbl = typeof r === 'string' ? r : (r?.label || r?.value || '');
                  return (
                    <option key={val} value={val}>
                      {lbl}
                    </option>
                  );
                })}
              </select>
            </div>
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
                  disabled={isLoadingOptions || !!optionsError || !formMetadata}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded font-semibold shadow-lg shadow-emerald-950/50"
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
                  disabled={isLoadingOptions || !!optionsError || !formMetadata || !createForm.username || !createForm.firstName || !createForm.lastName || !createForm.mobileNumber || !createForm.nationality}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded font-semibold shadow-lg shadow-sky-950/50"
                >
                  Review & Create User
                </button>
              </>
            )}
          </div>
        </form>
      </Modal>

      {/* Modal: Shared Credential Success (Create User, Password Reset & Batch Import) */}
      <Modal
        isOpen={isCredentialSuccessModalOpen}
        onClose={closeCredentialSuccessModal}
        title=""
      >
        <div className="space-y-4 text-xs" data-testid="credential-success-modal">
          {/* Batch Queue Indicator */}
          {credentialBatchTotal > 1 && (
            <div className="flex items-center justify-between px-3 py-2 bg-slate-900/90 border border-slate-700/80 rounded-lg text-xs">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-sky-950 text-sky-300 border border-sky-800 rounded font-semibold text-[10px]">
                  BATCH QUEUE
                </span>
                <span className="text-slate-200 font-medium">
                  Credential {credentialBatchIndex} of {credentialBatchTotal}
                </span>
              </div>
              {credentialQueue.length > 0 && (
                <span className="text-slate-400 text-[11px]">
                  ({credentialQueue.length} more in queue)
                </span>
              )}
            </div>
          )}

          {/* Header Banner */}
          <div className="p-4 bg-emerald-950/80 border border-emerald-600/80 rounded-xl text-emerald-200">
            <div className="font-bold text-sm flex items-center gap-2 mb-1 text-emerald-300">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              <span>
                {activeCredential?.type === 'CREATE'
                  ? 'User created successfully'
                  : 'Password reset successfully'}
              </span>
            </div>
            <p className="text-[11px] text-emerald-200/90">
              {activeCredential?.type === 'CREATE'
                ? 'The user was created and verified in the remote client system, and synchronized to Central Console.'
                : 'The password reset was verified in the remote client system.'}
            </p>
          </div>

          {/* User & Client Details Card */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            {/* Selected Client */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
              <span className="text-slate-400 text-[11px] font-medium">Selected Client</span>
              <span className="font-semibold text-white font-mono text-xs">
                {activeCredential?.clientCode || selectedClient?.clientCode || 'N/A'}
                {(activeCredential?.clientName || selectedClient?.clientName) ? ` (${activeCredential?.clientName || selectedClient?.clientName})` : ''}
              </span>
            </div>

            {/* Username Row */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
              <div>
                <span className="text-slate-400 text-[11px] block font-medium">Username</span>
                <span className="font-mono text-sm font-bold text-white" data-testid="credential-username">
                  {activeCredential?.username || 'N/A'}
                </span>
                {activeCredential?.fullName && (
                  <span className="text-slate-400 text-[11px] block">
                    ({activeCredential.fullName})
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (activeCredential?.username) {
                    navigator.clipboard.writeText(activeCredential.username);
                    setCopiedCredentialUsername(true);
                    setTimeout(() => setCopiedCredentialUsername(false), 2000);
                  }
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-semibold transition-colors"
                title="Copy Username"
              >
                <Copy className="w-3.5 h-3.5" />
                {copiedCredentialUsername ? 'Copied!' : 'Copy Username'}
              </button>
            </div>

            {/* Password Section */}
            <div className="pt-1">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-slate-400 text-[11px] font-medium">
                  {activeCredential?.type === 'CREATE' ? 'Default Password' : 'New/Default Password'}
                </span>
                {activeCredential?.password && !isCredentialExpired && !activeCredential?.isRestricted && (
                  <span className="text-amber-400 font-mono text-[10px] flex items-center gap-1" data-testid="credential-countdown">
                    <Clock className="w-3 h-3" /> Auto-clears in {credentialPasswordCountdown}s
                  </span>
                )}
              </div>

              {isCredentialExpired || activeCredential?.isExpiredBeforeViewing ? (
                <div className="p-3 bg-amber-950/40 rounded-lg border border-amber-800/60 text-amber-300 text-xs font-semibold" data-testid="credential-expired-notice">
                  {activeCredential?.isExpiredBeforeViewing ? 'Default password display expired before viewing' : 'Default password display expired'}
                </div>
              ) : activeCredential?.isRestricted ? (
                <div className="p-3 bg-slate-900/80 rounded-lg border border-amber-800/40 text-amber-300 text-xs font-medium italic" data-testid="credential-restricted-notice">
                  Default Password: Restricted
                </div>
              ) : activeCredential?.password ? (
                <div className="flex items-center justify-between bg-slate-900 px-3.5 py-3 rounded-lg border border-slate-700/80">
                  <span className="font-mono text-base font-bold text-emerald-400 tracking-wider select-all" data-testid="credential-password">
                    {activeCredential.password}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (activeCredential?.password) {
                        navigator.clipboard.writeText(activeCredential.password);
                        setCopiedCredentialPassword(true);
                        setTimeout(() => setCopiedCredentialPassword(false), 2000);
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold transition-colors"
                    title="Copy Password"
                    data-testid="btn-copy-password"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copiedCredentialPassword ? 'Copied!' : 'Copy Password'}</span>
                  </button>
                </div>
              ) : (
                <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800 text-slate-400 text-xs italic" data-testid="credential-unavailable-notice">
                  Default Password: Not returned by client
                </div>
              )}
            </div>

            {/* Role Mapping Status Row if applicable */}
            {activeCredential?.roleMappingStatus && (
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Role Mapping:</span>
                <span className={`font-semibold ${activeCredential.roleMappingStatus === 'COMPLETED' ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {activeCredential.roleMappingStatus === 'COMPLETED' ? 'Completed & Verified' : 'Pending / Partial Failed'}
                </span>
              </div>
            )}
          </div>

          {/* Ephemeral Policy Note */}
          <div className="p-2.5 bg-slate-900/40 rounded-lg border border-slate-800/60 text-[11px] text-slate-400 flex items-start gap-2">
            <Shield className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>
              This credential is held only in ephemeral memory and is never persisted to database tables, audit logs, or browser storage. Copy and provide it securely to the operator.
            </span>
          </div>

          {/* Modal Footer */}
          <div className="flex justify-between items-center pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={closeCredentialSuccessModal}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-semibold text-xs transition-colors"
              data-testid="btn-close-credential-modal"
            >
              {credentialQueue.length > 0 ? 'Dismiss All' : 'Close'}
            </button>
            {credentialQueue.length > 0 ? (
              <button
                type="button"
                onClick={handleNextOrCloseCredentialModal}
                className="px-5 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-semibold text-xs transition-colors flex items-center gap-1.5"
                data-testid="btn-next-credential"
              >
                <span>Next User Credential ({credentialQueue.length} left)</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleNextOrCloseCredentialModal}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-xs transition-colors"
                data-testid="btn-acknowledge-credential"
              >
                Acknowledge
              </button>
            )}
          </div>
        </div>
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

      {/* Modal: Activate/Deactivate in Simplex with Progress & Auto-Close */}
      <Modal
        isOpen={isStatusModalOpen}
        onClose={handleCloseStatusModal}
        title={selectedUser?.status === 'ACTIVE' ? 'Deactivate in Simplex' : 'Activate in Simplex'}
      >
        {selectedUser && (
          <div className="space-y-4 text-xs">
            {/* 1. Progress State */}
            {isMutatingStatus && (
              <div className="p-4 bg-sky-950/60 border border-sky-800 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
                    <span className="font-semibold text-sky-200 text-sm">
                      {statusMutationStage || 'Updating remote status…'}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-sky-400">({statusMutationElapsed}s)</span>
                </div>
                <p className="text-slate-400 text-[11px]">
                  Automation agent is executing live status toggle and verifying on {selectedClient?.clientCode || 'Simplex'}.
                </p>
              </div>
            )}

            {/* 2. Success State */}
            {statusMutationSuccess && !isMutatingStatus && (
              <div className="p-4 bg-emerald-950/70 border border-emerald-700 rounded-lg flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <span className="font-semibold text-emerald-200 text-sm block">Status Updated Successfully</span>
                  <span className="text-emerald-300 text-xs">{statusMutationSuccess}</span>
                </div>
              </div>
            )}

            {/* 3. Error State */}
            {statusMutationError && !isMutatingStatus && (
              <div className="p-4 bg-red-950/70 border border-red-800 rounded-lg space-y-2">
                <div className="flex items-center gap-2 text-red-300 font-semibold text-sm">
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                  <span>Operation Failed</span>
                </div>
                <p className="text-red-300 text-xs pl-7">{statusMutationError}</p>
                <div className="flex justify-end gap-2 pt-2 border-t border-red-900/50">
                  <button
                    type="button"
                    onClick={handleCloseStatusModal}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold text-xs"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={handleStatusChange}
                    className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded font-semibold text-xs flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry
                  </button>
                </div>
              </div>
            )}

            {/* 4. Default Confirmation State */}
            {!isMutatingStatus && !statusMutationSuccess && !statusMutationError && (
              <>
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
                    onClick={handleCloseStatusModal}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleStatusChange}
                    className={`px-4 py-2 rounded font-semibold text-white shadow ${
                      selectedUser.status === 'ACTIVE'
                        ? 'bg-red-600 hover:bg-red-500'
                        : 'bg-emerald-600 hover:bg-emerald-500'
                    }`}
                  >
                    {selectedUser.status === 'ACTIVE'
                      ? 'Deactivate in Simplex'
                      : 'Activate in Simplex'}
                  </button>
                </div>
              </>
            )}
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

      {/* Modal: Export Users Selection */}
      <Modal
        isOpen={isExportModalOpen}
        onClose={() => {
          if (!isExporting) {
            setIsExportModalOpen(false);
            setExportError(null);
          }
        }}
        title="Export Users"
      >
        <div className="space-y-4 text-xs">
          {/* Selected Client Info */}
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
            <span className="text-slate-500 block text-[10px] uppercase font-semibold">Selected Client</span>
            <span className="font-bold text-white text-sm">
              {selectedClient?.clientCode} — {selectedClient?.clientName}
            </span>
          </div>

          {/* Export Mode Selection */}
          <div className="space-y-2.5">
            <label className="block text-slate-400 font-semibold text-[11px] uppercase tracking-wider">
              Select Export Option
            </label>

            {/* Option 1: All Users */}
            <div
              onClick={() => !isExporting && setExportMode('ALL_USERS')}
              className={`p-3.5 rounded-lg border cursor-pointer transition-all ${
                exportMode === 'ALL_USERS'
                  ? 'bg-sky-950/40 border-sky-500 shadow-md ring-1 ring-sky-500/30'
                  : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <input
                    type="radio"
                    name="exportMode"
                    value="ALL_USERS"
                    checked={exportMode === 'ALL_USERS'}
                    onChange={() => setExportMode('ALL_USERS')}
                    disabled={isExporting}
                    className="text-sky-500 focus:ring-0 focus:ring-offset-0 bg-slate-900 border-slate-700 cursor-pointer"
                  />
                  <div>
                    <div className="font-bold text-white text-xs">All Users</div>
                    <div className="text-slate-400 text-[11px] mt-0.5">
                      Export both ACTIVE and INACTIVE users.
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <span className="px-2 py-0.5 bg-sky-900/60 text-sky-300 font-mono font-bold text-xs rounded border border-sky-700">
                    {exportCounts.total}
                  </span>
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                    {exportCounts.active} Active + {exportCounts.inactive} Inactive
                  </div>
                </div>
              </div>
            </div>

            {/* Option 2: Active Users Only */}
            <div
              onClick={() => !isExporting && setExportMode('ACTIVE_ONLY')}
              className={`p-3.5 rounded-lg border cursor-pointer transition-all ${
                exportMode === 'ACTIVE_ONLY'
                  ? 'bg-sky-950/40 border-sky-500 shadow-md ring-1 ring-sky-500/30'
                  : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <input
                    type="radio"
                    name="exportMode"
                    value="ACTIVE_ONLY"
                    checked={exportMode === 'ACTIVE_ONLY'}
                    onChange={() => setExportMode('ACTIVE_ONLY')}
                    disabled={isExporting}
                    className="text-sky-500 focus:ring-0 focus:ring-offset-0 bg-slate-900 border-slate-700 cursor-pointer"
                  />
                  <div>
                    <div className="font-bold text-white text-xs">Active Users Only</div>
                    <div className="text-slate-400 text-[11px] mt-0.5">
                      Export only users whose latest verified remote status is ACTIVE.
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <span className="px-2 py-0.5 bg-emerald-900/60 text-emerald-300 font-mono font-bold text-xs rounded border border-emerald-700">
                    {exportCounts.active}
                  </span>
                  <div className="text-[10px] text-emerald-500/80 font-mono mt-0.5">
                    Active only
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Export Failure Error Banner */}
          {exportError && (
            <div className="p-3 bg-red-950/80 border border-red-800 rounded-lg text-red-200 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span>{exportError}</span>
            </div>
          )}

          {/* Modal Action Buttons */}
          <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              disabled={isExporting}
              onClick={() => {
                setIsExportModalOpen(false);
                setExportError(null);
              }}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isExporting || !selectedClientId}
              onClick={handleExecuteExport}
              className="flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded font-semibold shadow disabled:opacity-50 transition-colors"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Preparing export…
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  Export Excel
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: Excel Import */}
      <Modal isOpen={isImportModalOpen} onClose={() => !importing && setIsImportModalOpen(false)} title={`Bulk User Excel Import: ${selectedClient?.clientCode || ''}`}>
        <div className="space-y-4 text-xs">
          <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-white">Selected Client: {selectedClient?.clientCode} ({selectedClient?.clientName})</div>
                <div className="text-slate-400 text-[11px] mt-0.5">Download sample workbook formatted with live client dropdown options and required column guidelines.</div>
              </div>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                disabled={isDownloadingTemplate || !selectedClientId}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {isDownloadingTemplate ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Preparing Sample…
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5 text-emerald-400" />
                    Download Sample Document
                  </>
                )}
              </button>
            </div>
            {templateDownloadError && (
              <div className="text-red-400 text-xs bg-red-950/40 p-2 rounded border border-red-800/50 flex items-center justify-between">
                <span>{templateDownloadError}</span>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="underline text-red-300 hover:text-red-200 text-xs font-medium ml-2"
                >
                  Retry
                </button>
              </div>
            )}
          </div>

          {/* Step 2: Choose Excel File */}
          <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 space-y-1.5">
            <label className="block text-slate-300 font-semibold text-xs">Choose Excel File (.xlsx)</label>
            <input
              type="file"
              accept=".xlsx"
              disabled={importing}
              onChange={handleImportFileChange}
              className="w-full text-xs text-slate-400 file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-sky-600 file:text-white file:font-semibold hover:file:bg-sky-500 cursor-pointer disabled:opacity-50"
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
                  <span className="text-amber-400 font-semibold">{importPreview.warningRows || 0} Warnings</span>
                  <span className="text-purple-400 font-semibold">{importPreview.alreadyExistingRows || 0} Already Existing</span>
                  <span className="text-red-400 font-semibold">{importPreview.errorRows} Errors</span>
                </div>
              </div>

              <div className="max-h-60 overflow-y-auto border border-slate-800 rounded bg-slate-950">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-900 text-slate-400 uppercase font-semibold sticky top-0">
                    <tr>
                      <th className="p-2">S.No</th>
                      <th className="p-2">Row</th>
                      <th className="p-2">Approve</th>
                      <th className="p-2">Username</th>
                      <th className="p-2">Full Name</th>
                      <th className="p-2">Mobile / Nat</th>
                      <th className="p-2">Role(s)</th>
                      <th className="p-2">Status / Classification</th>
                      <th className="p-2">Validation Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {importPreview.rows.map((r) => {
                      const isReady = r.classification === 'READY' || r.classification === 'READY_CREATE';
                      const isWarning = r.classification === 'WARNING_REQUIRES_CONFIRMATION' || r.classification === 'POTENTIAL_DUPLICATE_NAME';
                      const isAlreadyExists = r.classification === 'ALREADY_EXISTS' || r.errorCode === 'ALREADY_EXISTS';
                      const isDuplicate = r.classification === 'DUPLICATE' || r.classification === 'DUPLICATE_USERNAME' || r.classification === 'DUPLICATE_USERNAME_IN_FILE' || r.classification === 'DUPLICATE_SERIAL_NUMBER';

                      return (
                        <tr key={r.rowNumber} className="hover:bg-slate-900/50">
                          <td className="p-2 font-mono text-slate-400">{r.sNo !== undefined ? r.sNo : '-'}</td>
                          <td className="p-2 font-mono text-slate-500">{r.rowNumber}</td>
                          <td className="p-2 text-center">
                            <input
                              type="checkbox"
                              disabled={importing || (!isReady && !isWarning)}
                              checked={r.isApproved !== false && (isReady || isWarning)}
                              onChange={() => toggleRowApproval(r.rowNumber)}
                              className="rounded border-slate-700 bg-slate-800 text-sky-600 focus:ring-0 cursor-pointer disabled:opacity-30"
                              title={isWarning ? 'Check to approve creation despite duplicate name warning' : 'Include row in import'}
                            />
                          </td>
                          <td className="p-2 font-mono text-white font-medium">{r.username || '-'}</td>
                          <td className="p-2">{r.firstName} {r.lastName}</td>
                          <td className="p-2 text-slate-400">{r.mobileNumber || '-'} {r.nationality ? `(${r.nationality})` : ''}</td>
                          <td className="p-2">
                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                              {(r.roles && r.roles.length > 0
                                ? r.roles
                                : (r.parsedRoles && r.parsedRoles.length > 0
                                  ? r.parsedRoles
                                  : (r.role ? r.role.split(',').map((s) => s.trim()).filter(Boolean) : []))
                              ).map((rl, idx) => {
                                const isInvalid = r.invalidRoles?.includes(rl);
                                return (
                                  <span
                                    key={idx}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                      isInvalid
                                        ? 'bg-red-950/80 text-red-300 border-red-800'
                                        : 'bg-sky-950/80 text-sky-300 border-sky-800'
                                    }`}
                                  >
                                    {rl}
                                  </span>
                                );
                              })}
                              {!r.role && (!r.roles || r.roles.length === 0) && (
                                <span className="text-slate-500 text-xs">-</span>
                              )}
                            </div>
                          </td>
                          <td className="p-2">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                isReady
                                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                  : isWarning
                                  ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                  : isAlreadyExists
                                  ? 'bg-purple-950 text-purple-300 border border-purple-800'
                                  : isDuplicate
                                  ? 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                                  : 'bg-red-950 text-red-300 border border-red-800'
                              }`}
                            >
                              {isAlreadyExists && r.existingStatus
                                ? `ALREADY_EXISTS (${r.existingStatus})`
                                : r.classification}
                            </span>
                          </td>
                          <td className="p-2 text-slate-400">
                            {r.validationErrors && r.validationErrors.length > 0 ? (
                              <span className={isWarning ? 'text-amber-300' : isAlreadyExists ? 'text-purple-300' : 'text-red-400'}>
                                {r.validationErrors.join('; ')}
                              </span>
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

              {/* Live Execution Progress */}
              {importing && (
                <div className="p-3 bg-slate-900 border border-sky-800 rounded-lg space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-sky-300">
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Executing verified remote user creation on client…
                    </span>
                    <span>
                      {importProgress.processed} / {importProgress.total} Rows
                    </span>
                  </div>
                  <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                    <div
                      className="bg-sky-500 h-full transition-all duration-300"
                      style={{
                        width: `${importProgress.total > 0 ? (importProgress.processed / importProgress.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                    <span className="text-emerald-400 font-semibold">{importProgress.succeeded} Created</span>
                    <span className="text-red-400 font-semibold">{importProgress.failed} Failed</span>
                    <span className="text-amber-400 font-semibold">{importProgress.skipped} Skipped/Existing</span>
                  </div>
                </div>
              )}

              {/* Execution Summary & Equation Accounting */}
              {importExecution && (
                <div className="p-3 bg-slate-900 border border-slate-700 rounded-lg space-y-3">
                  <div className="font-bold text-white flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                      <span>Import Execution Summary</span>
                      {importExecution.batchStatus && (
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            importExecution.batchStatus === 'COMPLETED'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : importExecution.batchStatus === 'COMPLETED_WITH_ROW_ERRORS'
                              ? 'bg-amber-950 text-amber-300 border border-amber-800'
                              : 'bg-red-950 text-red-300 border border-red-800'
                          }`}
                        >
                          {importExecution.batchStatus.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleExportImportResults}
                      className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded text-xs font-semibold border border-emerald-800/80 transition-colors"
                    >
                      <Download className="w-3 h-3 text-emerald-400" />
                      Export Import Results (.xlsx)
                    </button>
                  </div>

                  {/* Accounting Grid: Total = Completed + Failed Before Creation + User Created Role Pending + Already Existing + Invalid + Skipped + Remaining */}
                  <div className="grid grid-cols-8 gap-1.5 text-center text-xs">
                    <div className="p-2 bg-slate-950 rounded border border-sky-800">
                      <span className="block text-slate-400 text-[10px] font-semibold">Total</span>
                      <span className="text-sky-300 font-bold text-sm">{importExecution.totalRows}</span>
                    </div>
                    <div className="p-2 bg-slate-950 rounded border border-emerald-900/60">
                      <span className="block text-slate-400 text-[10px]">Completed</span>
                      <span className="text-emerald-400 font-bold text-sm">{importExecution.completedRows ?? importExecution.createdRows ?? importExecution.succeededRows}</span>
                    </div>
                    <div className="p-2 bg-slate-950 rounded border border-red-950">
                      <span className="block text-slate-400 text-[10px]">Create Failed</span>
                      <span className="text-red-400 font-bold text-sm">{importExecution.failedBeforeCreationRows ?? importExecution.failedRows ?? 0}</span>
                    </div>
                    <div className="p-2 bg-slate-950 rounded border border-amber-950">
                      <span className="block text-slate-400 text-[10px]">Role Pending</span>
                      <span className="text-amber-400 font-bold text-sm">{importExecution.userCreatedRolePendingRows ?? 0}</span>
                    </div>
                    <div className="p-2 bg-slate-950 rounded border border-slate-800">
                      <span className="block text-slate-500 text-[10px]">Already Exists</span>
                      <span className="text-purple-400 font-bold text-sm">{importExecution.alreadyExistingRows ?? 0}</span>
                    </div>
                    <div className="p-2 bg-slate-950 rounded border border-slate-800">
                      <span className="block text-slate-500 text-[10px]">Invalid</span>
                      <span className="text-amber-400 font-bold text-sm">{importExecution.invalidRows ?? 0}</span>
                    </div>
                    <div className="p-2 bg-slate-950 rounded border border-slate-800">
                      <span className="block text-slate-500 text-[10px]">Skipped</span>
                      <span className="text-slate-400 font-bold text-sm">{importExecution.skippedRows ?? (importExecution.cancelledRows ?? 0) + (importExecution.notProcessedRows ?? 0)}</span>
                    </div>
                    <div className="p-2 bg-slate-950 rounded border border-slate-800">
                      <span className="block text-slate-500 text-[10px]">Remaining</span>
                      <span className="text-slate-400 font-bold text-sm">{importExecution.remainingUnprocessedRows ?? 0}</span>
                    </div>
                  </div>

                  {/* Results Table */}
                  <div className="max-h-56 overflow-y-auto border border-slate-800 rounded bg-slate-950">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-slate-900 text-slate-400 uppercase font-semibold sticky top-0">
                        <tr>
                          <th className="p-2">S.No</th>
                          <th className="p-2">Row</th>
                          <th className="p-2">Username</th>
                          <th className="p-2">Full Name</th>
                          <th className="p-2">Overall</th>
                          <th className="p-2">Stages</th>
                          <th className="p-2">Role Progress</th>
                          <th className="p-2">Reason / Next Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {importExecution.results.map((r, idx) => (
                          <tr key={idx} className="hover:bg-slate-900/50">
                            <td className="p-2 font-mono text-slate-400">{r.sNo !== undefined ? r.sNo : idx + 1}</td>
                            <td className="p-2 font-mono text-slate-500">{r.rowNumber}</td>
                            <td className="p-2 font-mono text-white font-medium">{r.username}</td>
                            <td className="p-2">{r.fullName}</td>
                            <td className="p-2">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  r.overallStatus === 'COMPLETED' || r.result === 'SUCCESS' || r.result === 'CREATED'
                                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                    : r.overallStatus === 'PARTIAL_FAILED' || r.result === 'PARTIAL_FAILED'
                                    ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                    : r.result === 'ALREADY_EXISTS'
                                    ? 'bg-purple-950 text-purple-300 border border-purple-800'
                                    : r.result === 'INVALID' || r.result === 'VALIDATION_FAILED'
                                    ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                    : r.errorCode === 'REMOTE_CREATE_UNCONFIRMED'
                                    ? 'bg-orange-950 text-orange-300 border border-orange-800'
                                    : 'bg-red-950 text-red-300 border border-red-800'
                                }`}
                              >
                                {r.overallStatus || r.result}
                              </span>
                            </td>
                            <td className="p-2">
                              <div className="flex items-center gap-1 text-[9px]">
                                <span title={`Creation: ${r.creationState || 'N/A'}`} className={`px-1 rounded ${r.creationState === 'COMPLETED' ? 'bg-emerald-900 text-emerald-200' : r.creationState === 'FAILED' ? 'bg-red-900 text-red-200' : 'bg-slate-800 text-slate-400'}`}>C</span>
                                <span title={`Search: ${r.userSearchState || 'N/A'}`} className={`px-1 rounded ${r.userSearchState === 'EXACT_MATCH_FOUND' ? 'bg-emerald-900 text-emerald-200' : r.userSearchState === 'AMBIGUOUS' || r.userSearchState === 'FAILED' ? 'bg-amber-900 text-amber-200' : 'bg-slate-800 text-slate-400'}`}>S</span>
                                <span title={`Role Selection: ${r.roleSelectionState || 'N/A'}`} className={`px-1 rounded ${r.roleSelectionState === 'SELECTED' ? 'bg-emerald-900 text-emerald-200' : r.roleSelectionState === 'PARTIAL' || r.roleSelectionState === 'FAILED' ? 'bg-amber-900 text-amber-200' : 'bg-slate-800 text-slate-400'}`}>R</span>
                                <span title={`Verification: ${r.roleVerificationState || 'N/A'}`} className={`px-1 rounded ${r.roleVerificationState === 'PASSED' ? 'bg-emerald-900 text-emerald-200' : r.roleVerificationState === 'FAILED' ? 'bg-red-900 text-red-200' : 'bg-slate-800 text-slate-400'}`}>V</span>
                              </div>
                            </td>
                            <td className="p-2 text-slate-300 text-[10px]">{r.roleSelectionProgress || (r.mappedRoles && r.mappedRoles.length > 0 ? r.mappedRoles.join(', ') : '—')}</td>
                            <td className="p-2 text-slate-400 max-w-xs truncate" title={r.failureReason || r.message}>{r.failureReason || r.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                <div>
                  {importExecution && importExecution.failedRows > 0 && (
                    <button
                      type="button"
                      disabled={importing}
                      onClick={handleRetryFailedRows}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-semibold shadow disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Retry Failed Rows Only ({importExecution.failedRows})
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={importing}
                    onClick={() => setIsImportModalOpen(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold disabled:opacity-50"
                  >
                    Close
                  </button>
                  {!importExecution && (
                    <button
                      type="button"
                      disabled={
                        importing ||
                        importPreview.rows.filter((r) => r.isApproved !== false && (r.classification.startsWith('READY') || r.classification === 'WARNING_REQUIRES_CONFIRMATION')).length === 0
                      }
                      onClick={handleImportExecute}
                      className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded font-semibold shadow disabled:opacity-50"
                    >
                      {importing
                        ? 'Executing on Client...'
                        : `Start Import (${
                            importPreview.rows.filter((r) => r.isApproved !== false && (r.classification.startsWith('READY') || r.classification === 'WARNING_REQUIRES_CONFIRMATION')).length
                          } Approved Rows)`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
