import React, { useState, useEffect, useCallback } from 'react';
import {
  Layers,
  Search,
  RefreshCw,
  Plus,
  FileSpreadsheet,
  Download,
  Link2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Filter,
  User,
  Building2,
  Stethoscope,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  MoreHorizontal,
  Play,
  RotateCcw,
} from 'lucide-react';
import { ApiClient, clientResourcesApi } from '../api/client.js';
import { useAuth } from '../context/AuthContext.js';
import { PERMISSIONS, ResourceImportStage } from '@hmc/shared';
import { Modal } from '../components/Modal.js';

interface ClientOption {
  id: string;
  clientCode: string;
  clientName: string;
  environment: string;
}

interface ResourceItem {
  id: string;
  clientId: string;
  clientCode?: string;
  remoteResourceId: string;
  resourceName: string;
  isResourceHuman: boolean;
  resourceTypeName?: string | null;
  specialtyName?: string | null;
  linkedUsername?: string | null;
  remoteStatus: 'ACTIVE' | 'INACTIVE';
  lastSyncedAt?: string;
}

export const ResourcesPage: React.FC = () => {
  const { hasPermission } = useAuth();

  // Client Selection State
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [isLoadingClients, setIsLoadingClients] = useState<boolean>(true);

  // Resources Data State
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Reference lists
  const [resourceTypes, setResourceTypes] = useState<string[]>([]);
  const [specialties, setSpecialties] = useState<string[]>([]);

  // Filters and Pagination
  const [search, setSearch] = useState<string>('');
  const [specialtyFilter, setSpecialtyFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [isHumanFilter, setIsHumanFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [page, setPage] = useState<number>(1);
  const [limit] = useState<number>(15);

  // Modals State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [isLinkUserModalOpen, setIsLinkUserModalOpen] = useState<boolean>(false);
  const [selectedResourceForLink, setSelectedResourceForLink] = useState<ResourceItem | null>(null);

  // Create Form State
  const [createForm, setCreateForm] = useState({
    resourceName: '',
    isResourceHuman: true,
    resourceType: 'Consultant Physician',
    specialty: 'Cardiology',
    departments: 'ALL',
    services: 'ALL',
    colorIdentificationCode: 'FFFFFF',
    operatingFrom: '00:00',
    operatingTo: '23:55',
  });
  const [isSubmittingCreate, setIsSubmittingCreate] = useState<boolean>(false);

  // Link User Form State
  const [linkUsername, setLinkUsername] = useState<string>('');
  const [isSubmittingLink, setIsSubmittingLink] = useState<boolean>(false);

  // 10-Sheet Import Workflow State
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
  const [isExecutingImport, setIsExecutingImport] = useState<boolean>(false);
  const [isRetryingImport, setIsRetryingImport] = useState<boolean>(false);
  const [previewData, setPreviewData] = useState<any | null>(null);
  const [activeJob, setActiveJob] = useState<any | null>(null);

  // Load clients on mount
  useEffect(() => {
    loadClients();
  }, []);

  const loadClients = async () => {
    setIsLoadingClients(true);
    try {
      const res = await ApiClient.request<ClientOption[]>('/clients');
      setClients(res || []);
      if (res && res.length > 0) {
        setSelectedClientId(res[0].id);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load client list');
    } finally {
      setIsLoadingClients(false);
    }
  };

  // Load reference data
  useEffect(() => {
    if (!selectedClientId) return;
    clientResourcesApi.getResourceTypes(selectedClientId).then(setResourceTypes).catch(() => {});
    clientResourcesApi.getSpecialties(selectedClientId).then(setSpecialties).catch(() => {});
  }, [selectedClientId]);

  // Load resources when client or filters change
  const fetchResources = useCallback(async () => {
    if (!selectedClientId) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await clientResourcesApi.getResources({
        clientId: selectedClientId,
        search: search.trim() || undefined,
        specialty: specialtyFilter || undefined,
        resourceType: typeFilter || undefined,
        isResourceHuman: isHumanFilter === 'true' ? true : isHumanFilter === 'false' ? false : undefined,
        status: statusFilter,
        page,
        limit,
      });
      setResources(res.data || []);
      setTotalCount(res.total || 0);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to fetch client resources');
    } finally {
      setIsLoading(false);
    }
  }, [selectedClientId, search, specialtyFilter, typeFilter, isHumanFilter, statusFilter, page, limit]);

  useEffect(() => {
    fetchResources();
  }, [fetchResources]);

  // Sync resources trigger
  const handleSync = async () => {
    if (!selectedClientId || isSyncing) return;
    setIsSyncing(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await clientResourcesApi.syncResources(selectedClientId);
      setSuccessMessage(res.message || 'Resource discovery completed.');
      fetchResources();
    } catch (err: any) {
      setErrorMessage(err.message || 'Resource synchronization failed.');
    } finally {
      setIsSyncing(false);
    }
  };

  // Create Quick Resource
  const handleCreateResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || isSubmittingCreate) return;
    setIsSubmittingCreate(true);
    setErrorMessage(null);
    try {
      const res = await clientResourcesApi.createResource({
        clientId: selectedClientId,
        ...createForm,
      });
      setSuccessMessage(`Resource created successfully with ID: ${res.resource?.remoteResourceId || 'New'}`);
      setIsCreateModalOpen(false);
      setCreateForm({
        resourceName: '',
        isResourceHuman: true,
        resourceType: 'Consultant Physician',
        specialty: 'Cardiology',
        departments: 'ALL',
        services: 'ALL',
        colorIdentificationCode: 'FFFFFF',
        operatingFrom: '00:00',
        operatingTo: '23:55',
      });
      fetchResources();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to create resource.');
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  // Toggle status
  const handleToggleStatus = async (resource: ResourceItem) => {
    if (!selectedClientId) return;
    const targetStatus = resource.remoteStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await clientResourcesApi.setResourceStatus({
        clientId: selectedClientId,
        remoteResourceId: resource.remoteResourceId,
        status: targetStatus,
      });
      setSuccessMessage(`Resource '${resource.remoteResourceId}' status set to ${targetStatus}.`);
      fetchResources();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update resource status.');
    }
  };

  // Map user
  const handleLinkUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !selectedResourceForLink || !linkUsername.trim() || isSubmittingLink) return;
    setIsSubmittingLink(true);
    try {
      await clientResourcesApi.mapResourceUser({
        clientId: selectedClientId,
        remoteResourceId: selectedResourceForLink.remoteResourceId,
        username: linkUsername.trim(),
      });
      setSuccessMessage(`Mapped resource '${selectedResourceForLink.remoteResourceId}' to user '${linkUsername.trim()}'.`);
      setIsLinkUserModalOpen(false);
      setLinkUsername('');
      setSelectedResourceForLink(null);
      fetchResources();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to link user to resource.');
    } finally {
      setIsSubmittingLink(false);
    }
  };

  // Preview Uploaded 10-Sheet Workbook
  const handlePreviewUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedClientId) return;
    setImportFile(file);
    setIsPreviewLoading(true);
    setErrorMessage(null);
    setPreviewData(null);
    setActiveJob(null);

    try {
      const res = await clientResourcesApi.importPreview(selectedClientId, file);
      setPreviewData(res);
      setSuccessMessage(`Workbook parsed: ${res.validRows} valid rows, ${res.errorRows} errors.`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to preview workbook.');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // Execute Import
  const handleExecuteImport = async () => {
    if (!previewData?.jobId || isExecutingImport) return;
    setIsExecutingImport(true);
    setErrorMessage(null);
    try {
      const res = await clientResourcesApi.importExecute(previewData.jobId);
      const jobDetails = await clientResourcesApi.getImportJob(previewData.jobId);
      setActiveJob(jobDetails);
      setSuccessMessage(`Import completed: ${res.completedRows} completed, ${res.failedRows} failed.`);
      fetchResources();
    } catch (err: any) {
      setErrorMessage(err.message || 'Import execution failed.');
    } finally {
      setIsExecutingImport(false);
    }
  };

  // Retry Failed Rows
  const handleRetryFailed = async () => {
    if (!activeJob?.id || isRetryingImport) return;
    setIsRetryingImport(true);
    setErrorMessage(null);
    try {
      const res = await clientResourcesApi.retryImportJob(activeJob.id);
      const jobDetails = await clientResourcesApi.getImportJob(activeJob.id);
      setActiveJob(jobDetails);
      setSuccessMessage(`Retry completed: ${res.newlyCompleted} newly completed.`);
      fetchResources();
    } catch (err: any) {
      setErrorMessage(err.message || 'Retry failed.');
    } finally {
      setIsRetryingImport(false);
    }
  };

  // Export Results
  const handleExportJobResults = async () => {
    if (!activeJob?.id) return;
    try {
      const { blob, filename } = await clientResourcesApi.exportJobResults(activeJob.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `Resource_Import_Results_${activeJob.id.slice(0, 8)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to export job results.');
    }
  };

  // Download 10-Sheet Template
  const handleDownloadTemplate = async () => {
    const selectedClient = clients.find((c) => c.id === selectedClientId);
    try {
      const { blob, filename } = await clientResourcesApi.downloadTemplate(selectedClientId, selectedClient?.clientCode);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'HMC_Client_Resources_Template.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to download template.');
    }
  };

  // Export
  const handleExport = async (mode: 'ALL' | 'ACTIVE_ONLY') => {
    if (!selectedClientId) return;
    try {
      const { blob, filename } = await clientResourcesApi.exportResources(selectedClientId, mode);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `Resources_Export_${mode}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to export resources.');
    }
  };

  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const totalPages = Math.ceil(totalCount / limit) || 1;

  // Compute stat counters
  const activeHumans = resources.filter((r) => r.isResourceHuman && r.remoteStatus === 'ACTIVE').length;
  const activeNonHumans = resources.filter((r) => !r.isResourceHuman && r.remoteStatus === 'ACTIVE').length;
  const activeLinked = resources.filter((r) => r.linkedUsername && r.remoteStatus === 'ACTIVE').length;

  return (
    <div className="space-y-6">
      {/* Top Header & Client Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-surface p-6 rounded-xl border border-surface-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-sky-600/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100">Resource Management</h1>
            <p className="text-xs text-slate-400">
              Isolated directory of human practitioners, rooms, equipment, and portal role mappings
            </p>
          </div>
        </div>

        {/* Client Selection Dropdown */}
        <div className="flex items-center gap-3">
          <div className="text-xs text-slate-400 font-medium">Selected Client:</div>
          <select
            value={selectedClientId}
            onChange={(e) => {
              setSelectedClientId(e.target.value);
              setPage(1);
            }}
            disabled={isLoadingClients}
            className="bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 font-medium focus:outline-none focus:border-sky-500"
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.clientCode} - {c.clientName} ({c.environment})
              </option>
            ))}
          </select>

          {hasPermission(PERMISSIONS.CLIENT_RESOURCES_SYNC) && (
            <button
              onClick={handleSync}
              disabled={isSyncing || !selectedClientId}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold transition-all shadow-md ${
                isSyncing
                  ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
                  : 'bg-sky-600 hover:bg-sky-500 text-white shadow-sky-900/30'
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing…' : 'Sync Resources'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      {errorMessage && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
      {successMessage && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Metrics Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface border border-surface-border p-4 rounded-xl flex items-center gap-4">
          <div className="p-3 bg-sky-500/10 text-sky-400 rounded-lg">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">Total Resources</div>
            <div className="text-2xl font-bold text-slate-100">{totalCount}</div>
          </div>
        </div>

        <div className="bg-surface border border-surface-border p-4 rounded-xl flex items-center gap-4">
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-lg">
            <Stethoscope className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">Human Practitioners</div>
            <div className="text-2xl font-bold text-slate-100">{activeHumans}</div>
          </div>
        </div>

        <div className="bg-surface border border-surface-border p-4 rounded-xl flex items-center gap-4">
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-lg">
            <User className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">Linked Console Users</div>
            <div className="text-2xl font-bold text-slate-100">{activeLinked}</div>
          </div>
        </div>

        <div className="bg-surface border border-surface-border p-4 rounded-xl flex items-center gap-4">
          <div className="p-3 bg-amber-500/10 text-amber-400 rounded-lg">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">Rooms / Equipment</div>
            <div className="text-2xl font-bold text-slate-100">{activeNonHumans}</div>
          </div>
        </div>
      </div>

      {/* Controls & Filter Bar */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-surface p-4 rounded-xl border border-surface-border">
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Search */}
          <div className="relative min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search code, name, user…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg pl-9 pr-3 py-2 placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          {/* Is Human Filter */}
          <select
            value={isHumanFilter}
            onChange={(e) => {
              setIsHumanFilter(e.target.value);
              setPage(1);
            }}
            className="bg-slate-900 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500"
          >
            <option value="ALL">All Human/Non-Human</option>
            <option value="true">Human (Doctors/Staff)</option>
            <option value="false">Non-Human (Rooms/Equip)</option>
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="bg-slate-900 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active Only</option>
            <option value="INACTIVE">Inactive Only</option>
          </select>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          {hasPermission(PERMISSIONS.CLIENT_RESOURCES_CREATE) && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold transition-all shadow-md shadow-emerald-900/30"
            >
              <Plus className="w-4 h-4" />
              <span>Add Resource</span>
            </button>
          )}

          {hasPermission(PERMISSIONS.CLIENT_RESOURCES_IMPORT) && (
            <button
              onClick={() => {
                setIsImportModalOpen(true);
                setPreviewData(null);
                setActiveJob(null);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-sm font-medium transition-all"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              <span>Import Excel</span>
            </button>
          )}

          {hasPermission(PERMISSIONS.CLIENT_RESOURCES_EXPORT) && (
            <button
              onClick={() => handleExport('ALL')}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-sm font-medium transition-all"
              title="Export to Excel"
            >
              <Download className="w-4 h-4 text-sky-400" />
              <span>Export</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-surface rounded-xl border border-surface-border overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/80 text-xs uppercase text-slate-400 border-b border-surface-border font-semibold">
              <tr>
                <th className="px-6 py-4">Resource Code</th>
                <th className="px-6 py-4">Resource Name</th>
                <th className="px-6 py-4">Is Human</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Specialty</th>
                <th className="px-6 py-4">Linked Console User</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-sky-400" />
                    Loading resources…
                  </td>
                </tr>
              ) : resources.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-500">
                    No resources found. Click "Add Resource" or "Import Excel" to create records.
                  </td>
                </tr>
              ) : (
                resources.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-6 py-4 font-mono font-bold text-sky-400 text-xs">
                      {item.remoteResourceId}
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-100">
                      {item.resourceName}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                          item.isResourceHuman
                            ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-800/40'
                            : 'bg-amber-950/40 text-amber-400 border border-amber-800/40'
                        }`}
                      >
                        {item.isResourceHuman ? 'Yes (Human)' : 'No (Facility)'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-300">
                      {item.resourceTypeName || '—'}
                    </td>
                    <td className="px-6 py-4 text-slate-300">
                      {item.specialtyName || '—'}
                    </td>
                    <td className="px-6 py-4">
                      {item.linkedUsername ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-sky-300 bg-sky-950/40 border border-sky-800/40 px-2 py-0.5 rounded">
                          <User className="w-3 h-3 text-sky-400" />
                          {item.linkedUsername}
                        </span>
                      ) : (
                        <span className="text-slate-600 text-xs">Unlinked</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                          item.remoteStatus === 'ACTIVE'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            item.remoteStatus === 'ACTIVE' ? 'bg-emerald-400' : 'bg-rose-400'
                          }`}
                        />
                        {item.remoteStatus}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {hasPermission(PERMISSIONS.CLIENT_RESOURCE_USER_MAP) && item.isResourceHuman && (
                          <button
                            onClick={() => {
                              setSelectedResourceForLink(item);
                              setLinkUsername(item.linkedUsername || '');
                              setIsLinkUserModalOpen(true);
                            }}
                            className="p-1.5 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded transition-colors"
                            title="Link to Portal User (/addParentResourceUser)"
                          >
                            <Link2 className="w-4 h-4" />
                          </button>
                        )}

                        {hasPermission(PERMISSIONS.CLIENT_RESOURCES_STATUS_CHANGE) && (
                          <button
                            onClick={() => handleToggleStatus(item)}
                            className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                              item.remoteStatus === 'ACTIVE'
                                ? 'bg-slate-800 hover:bg-rose-900/30 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-800/40'
                                : 'bg-slate-800 hover:bg-emerald-900/30 text-slate-400 hover:text-emerald-400 border border-slate-700 hover:border-emerald-800/40'
                            }`}
                          >
                            {item.remoteStatus === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900/50 border-t border-surface-border text-xs text-slate-400">
          <div>
            Showing <span className="font-semibold text-slate-200">{resources.length}</span> of{' '}
            <span className="font-semibold text-slate-200">{totalCount}</span> resources
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded border border-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 rounded border border-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* CREATE QUICK RESOURCE MODAL */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Add Resource (/addResourceParentDetails)"
      >
        <form onSubmit={handleCreateResource} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
              Resource Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Dr. Faisal Al-Harbi"
              value={createForm.resourceName}
              onChange={(e) => setCreateForm({ ...createForm, resourceName: e.target.value })}
              className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                Is Resource Human *
              </label>
              <select
                value={createForm.isResourceHuman ? 'Yes' : 'No'}
                onChange={(e) => setCreateForm({ ...createForm, isResourceHuman: e.target.value === 'Yes' })}
                className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500"
              >
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                Resource Type *
              </label>
              <select
                value={createForm.resourceType}
                onChange={(e) => setCreateForm({ ...createForm, resourceType: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500"
              >
                {resourceTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                Specialty *
              </label>
              <select
                value={createForm.specialty}
                onChange={(e) => setCreateForm({ ...createForm, specialty: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500"
              >
                {specialties.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                Color Code
              </label>
              <input
                type="text"
                value={createForm.colorIdentificationCode}
                onChange={(e) => setCreateForm({ ...createForm, colorIdentificationCode: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                Departments
              </label>
              <input
                type="text"
                value={createForm.departments}
                onChange={(e) => setCreateForm({ ...createForm, departments: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                Services
              </label>
              <input
                type="text"
                value={createForm.services}
                onChange={(e) => setCreateForm({ ...createForm, services: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-surface-border">
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(false)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmittingCreate}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-all shadow-md shadow-emerald-900/30 flex items-center gap-2"
            >
              {isSubmittingCreate && <RefreshCw className="w-4 h-4 animate-spin" />}
              <span>{isSubmittingCreate ? 'Saving…' : 'Save Resource'}</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* LINK USER MODAL */}
      <Modal
        isOpen={isLinkUserModalOpen}
        onClose={() => {
          setIsLinkUserModalOpen(false);
          setSelectedResourceForLink(null);
        }}
        title={`Map Resource User (/addParentResourceUser)`}
      >
        <form onSubmit={handleLinkUser} className="space-y-4">
          <p className="text-xs text-slate-400">
            Map resource <strong className="text-slate-200">{selectedResourceForLink?.resourceName}</strong> ({selectedResourceForLink?.remoteResourceId}) to an active portal username.
          </p>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
              Portal Username *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. dr_faisal"
              value={linkUsername}
              onChange={(e) => setLinkUsername(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500 font-mono"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-surface-border">
            <button
              type="button"
              onClick={() => setIsLinkUserModalOpen(false)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmittingLink}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-all shadow-md shadow-sky-900/30 flex items-center gap-2"
            >
              {isSubmittingLink && <RefreshCw className="w-4 h-4 animate-spin" />}
              <span>{isSubmittingLink ? 'Saving…' : 'Save Mapping'}</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* 10-SHEET COMBINED IMPORT WORKFLOW MODAL */}
      <Modal
        isOpen={isImportModalOpen}
        onClose={() => {
          setIsImportModalOpen(false);
          setImportFile(null);
          setPreviewData(null);
          setActiveJob(null);
        }}
        title="10-Sheet Resource & User Excel Import"
        maxWidth="max-w-3xl"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-slate-900/60 rounded-lg border border-slate-800">
            <span className="text-xs text-slate-300">Download 10-sheet client-bound template:</span>
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 font-semibold"
            >
              <Download className="w-3.5 h-3.5" />
              Download Template
            </button>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
              Select 10-Sheet Excel Workbook (.xlsx)
            </label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handlePreviewUpload}
              disabled={isPreviewLoading}
              className="w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-sky-600 file:text-white hover:file:bg-sky-500 cursor-pointer"
            />
          </div>

          {isPreviewLoading && (
            <div className="py-6 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
              <span>Parsing and validating 10-sheet workbook…</span>
            </div>
          )}

          {/* PREVIEW SUMMARY */}
          {previewData && !activeJob && (
            <div className="space-y-3 pt-2">
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="p-2 rounded bg-slate-900 border border-slate-800 text-slate-300">
                  Total: <strong className="text-slate-100">{previewData.totalRows}</strong>
                </div>
                <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold">
                  Valid: {previewData.validRows}
                </div>
                <div className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 font-bold">
                  Errors: {previewData.errorRows}
                </div>
              </div>

              <div className="max-h-52 overflow-y-auto divide-y divide-slate-800 rounded border border-slate-800 bg-slate-950 p-2 text-xs">
                {previewData.rows?.map((r: any) => (
                  <div key={r.rowNumber} className="py-1.5 flex items-center justify-between">
                    <div>
                      <span className="font-mono text-slate-300 mr-2">#{r.rowNumber}</span>
                      <strong className="text-slate-100">{r.resourceName}</strong>
                      <span className="text-slate-400 text-xs ml-2">({r.isResourceHuman ? 'Human' : 'Facility'})</span>
                      {r.errors?.length > 0 && (
                        <div className="text-rose-400 text-[11px] mt-0.5">{r.errors.join('; ')}</div>
                      )}
                    </div>
                    <span
                      className={`font-semibold text-xs ${
                        r.isValid ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {r.isValid ? 'VALID' : 'INVALID'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-surface-border">
                <button
                  type="button"
                  onClick={() => {
                    setPreviewData(null);
                    setImportFile(null);
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExecuteImport}
                  disabled={isExecutingImport || previewData.validRows === 0}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold flex items-center gap-2"
                >
                  {isExecutingImport ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  <span>{isExecutingImport ? 'Executing…' : 'Execute Import'}</span>
                </button>
              </div>
            </div>
          )}

          {/* ACTIVE / COMPLETED JOB PROGRESS */}
          {activeJob && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-300">
                  Import Status: <span className="text-sky-400 uppercase font-bold">{activeJob.status}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExportJobResults}
                    className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 font-semibold"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export Results
                  </button>
                  {activeJob.failedRows > 0 && (
                    <button
                      type="button"
                      onClick={handleRetryFailed}
                      disabled={isRetryingImport}
                      className="text-xs px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded flex items-center gap-1 font-semibold"
                    >
                      <RotateCcw className={`w-3.5 h-3.5 ${isRetryingImport ? 'animate-spin' : ''}`} />
                      <span>Retry Failed ({activeJob.failedRows})</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="p-2 rounded bg-slate-900 border border-slate-800 text-slate-300">
                  Total: <strong>{activeJob.totalRows}</strong>
                </div>
                <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold">
                  Completed: {activeJob.completedRows}
                </div>
                <div className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 font-bold">
                  Failed: {activeJob.failedRows}
                </div>
              </div>

              <div className="max-h-56 overflow-y-auto divide-y divide-slate-800 rounded border border-slate-800 bg-slate-950 p-2 text-xs">
                {activeJob.rows?.map((r: any) => (
                  <div key={r.rowNumber} className="py-2 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-400">#{r.rowNumber}</span>
                        <strong className="text-slate-100">{r.resourceName}</strong>
                        {r.remoteResourceId && (
                          <span className="text-sky-400 text-xs font-mono">[{r.remoteResourceId}]</span>
                        )}
                      </div>
                      <div className="text-slate-400 text-[11px] mt-0.5">
                        Stage: <span className="font-mono text-slate-300">{r.stage}</span>
                        {r.safeErrorMessage && (
                          <span className="text-rose-400 ml-2">— {r.safeErrorMessage}</span>
                        )}
                      </div>
                    </div>
                    <span
                      className={`font-semibold text-xs ${
                        r.status === 'SUCCESS'
                          ? 'text-emerald-400'
                          : r.status === 'PENDING'
                          ? 'text-amber-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-surface-border">
                <button
                  type="button"
                  onClick={() => {
                    setIsImportModalOpen(false);
                    setPreviewData(null);
                    setActiveJob(null);
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
