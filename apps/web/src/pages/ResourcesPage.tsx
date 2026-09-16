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
  Check,
  X,
  Copy,
  ExternalLink,
  Shield,
  FileText,
  Send,
  Key,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Sliders,
  Sparkles,
  Globe,
  Info,
} from 'lucide-react';
import { ApiClient, clientResourcesApi, clientUsersApi } from '../api/client.js';
import { useAuth } from '../context/AuthContext.js';
import {
  PERMISSIONS,
  ResourceImportStage,
  EmrFormMasterItem,
  EmrFormsQueryResult,
  CreateIntegratedResourceInput,
  CreateClientUserDto,
  ClientUser,
  AutomationInProgressResponse,
  UserCreationRunStatusResponse,
} from '@hmc/shared';
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
  resourceCode?: string;
  resourceName: string;
  isResourceHuman: boolean;
  resourceTypeName?: string | null;
  specialtyName?: string | null;
  resourceType?: string;
  specialty?: string;
  departments?: string;
  services?: string;
  colorIdentificationCode?: string;
  operatingFrom?: string;
  operatingTo?: string;
  branchId?: string;
  branchName?: string;
  linkedUserId?: string | null;
  linkedUsername?: string | null;
  remoteStatus: 'ACTIVE' | 'INACTIVE';
  lastSyncedAt?: string;
}

interface EphemeralCredential {
  username: string;
  password?: string;
  roles?: string[];
  clientName?: string;
  clientCode?: string;
}

const FALLBACK_NATIONALITIES: Array<{ label: string; value: string }> = [
  { label: 'Saudi ( SAU )', value: 'SAU' },
  { label: 'Emirati ( ARE )', value: 'ARE' },
  { label: 'Egyptian ( EGY )', value: 'EGY' },
  { label: 'Jordanian ( JOR )', value: 'JOR' },
  { label: 'Kuwaiti ( KWT )', value: 'KWT' },
  { label: 'Bahraini ( BHR )', value: 'BHR' },
  { label: 'Omani ( OMN )', value: 'OMN' },
  { label: 'Qatari ( QAT )', value: 'QAT' },
  { label: 'Syrian ( SYR )', value: 'SYR' },
  { label: 'Lebanese ( LBN )', value: 'LBN' },
  { label: 'Sudanese ( SDN )', value: 'SDN' },
  { label: 'Indian ( IND )', value: 'IND' },
  { label: 'Pakistani ( PAK )', value: 'PAK' },
  { label: 'Filipino ( PHL )', value: 'PHL' },
  { label: 'British ( GBR )', value: 'GBR' },
  { label: 'American ( USA )', value: 'USA' },
];


export const ResourcesPage: React.FC = () => {
  const { hasPermission } = useAuth();

  // Client Selection State
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [isLoadingClients, setIsLoadingClients] = useState<boolean>(true);

  // Resources Data State
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [resourceSummary, setResourceSummary] = useState<{ total: number; humanCount: number; nonHumanCount: number; linkedCount: number } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Reference lists
  const [resourceTypes, setResourceTypes] = useState<string[]>([]);
  const [humanResourceTypes, setHumanResourceTypes] = useState<string[]>([]);
  const [nonHumanResourceTypes, setNonHumanResourceTypes] = useState<string[]>([]);
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [emrFormsList, setEmrFormsList] = useState<EmrFormMasterItem[]>([]);
  const [emrFormsResult, setEmrFormsResult] = useState<EmrFormsQueryResult | null>(null);
  const [isLoadingEmrForms, setIsLoadingEmrForms] = useState<boolean>(false);
  const [nationalities, setNationalities] = useState<Array<{ label: string; value: string }>>([]);
  const [isLoadingNationalities, setIsLoadingNationalities] = useState<boolean>(false);
  const [eclaimOptions, setEclaimOptions] = useState<{
    supported?: boolean;
    isSupported?: boolean;
    roles?: string[];
    facilities?: string[];
    endpoint?: string;
    eclaimRoute?: string;
    providers?: any[];
  } | null>(null);

  // Filters and Pagination
  const [search, setSearch] = useState<string>('');
  const [specialtyFilter, setSpecialtyFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [isHumanFilter, setIsHumanFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [page, setPage] = useState<number>(1);
  const [limit] = useState<number>(15);

  // Export Menu State
  const [isExportMenuOpen, setIsExportMenuOpen] = useState<boolean>(false);

  // Modals State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [isLinkUserModalOpen, setIsLinkUserModalOpen] = useState<boolean>(false);
  const [selectedResourceForLink, setSelectedResourceForLink] = useState<ResourceItem | null>(null);
  const [togglingResourceId, setTogglingResourceId] = useState<string | null>(null);

  // Ephemeral Credential Display Modal
  const [ephemeralCredModalOpen, setEphemeralCredModalOpen] = useState<boolean>(false);
  const [createdCredential, setCreatedCredential] = useState<EphemeralCredential | null>(null);
  const [copiedPassword, setCopiedPassword] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);

  // 6-Stage Full Workflow Completion Success Modal
  const [workflowSuccessModalOpen, setWorkflowSuccessModalOpen] = useState<boolean>(false);
  const [workflowSuccessDetails, setWorkflowSuccessDetails] = useState<{
    resourceName: string;
    resourceCode: string;
    username: string;
    roles: string;
    mappedResource: string;
    eclaimStatus: string;
    selectedEmrForms: string[];
    targetBranch: string;
    defaultFormValue: string;
  } | null>(null);

  // Integrated Wizard State (6 Stages)
  const [activeStep, setActiveStep] = useState<number>(1);
  const [isSubmittingIntegrated, setIsSubmittingIntegrated] = useState<boolean>(false);
  const [submissionProgressStage, setSubmissionProgressStage] = useState<string | null>(null);
  const [resumeStage, setResumeStage] = useState<string | null>(null);

  // Wizard Form Fields
  // Section 1: Resource Details
  const [wResourceName, setWResourceName] = useState<string>('');
  const [wIsHuman, setWIsHuman] = useState<boolean>(true);
  const [wResourceType, setWResourceType] = useState<string>('DOCTORS');
  const [wSpecialty, setWSpecialty] = useState<string>('Cardiology');
  const [wDepartments, setWDepartments] = useState<string>('ALL');
  const [wServices, setWServices] = useState<string>('ALL');
  const [wColorCode, setWColorCode] = useState<string>('FFFFFF');
  const [wOperatingFrom, setWOperatingFrom] = useState<string>('00:00');
  const [wOperatingTo, setWOperatingTo] = useState<string>('23:55');
  const [wBranchId, setWBranchId] = useState<string>('');
  const [wBranchName, setWBranchName] = useState<string>('');

  // Section 2: Associated User Details
  const [wCreateUser, setWCreateUser] = useState<boolean>(true);
  const [wUsername, setWUsername] = useState<string>('');
  const [wFirstName, setWFirstName] = useState<string>('');
  const [wMiddleName, setWMiddleName] = useState<string>('');
  const [wLastName, setWLastName] = useState<string>('');
  const [wNickName, setWNickName] = useState<string>('');
  const [wEmail, setWEmail] = useState<string>('');
  const [wMobile, setWMobile] = useState<string>('');
  const [wNationality, setWNationality] = useState<string>('Saudi Arabia');
  const [wRoles, setWRoles] = useState<string>('');
  const [availableRoles, setAvailableRoles] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [roleSearch, setRoleSearch] = useState<string>('');
  const [isLoadingRoles, setIsLoadingRoles] = useState<boolean>(false);
  const [userOptionsSyncTime, setUserOptionsSyncTime] = useState<string | null>(null);
  const [userOptionsError, setUserOptionsError] = useState<string | null>(null);
  const [wProfileRole, setWProfileRole] = useState<string>('');
  const [wBarcode, setWBarcode] = useState<string>('');
  const [wReportsDays, setWReportsDays] = useState<number>(30);
  const [wSigWidth, setWSigWidth] = useState<number>(150);
  const [wSigHeight, setWSigHeight] = useState<number>(50);

  // File Uploads for Step 2
  const [wSignatureBase64, setWSignatureBase64] = useState<string>('');
  const [wSignatureFilename, setWSignatureFilename] = useState<string>('');
  const [wStampBase64, setWStampBase64] = useState<string>('');
  const [wStampFilename, setWStampFilename] = useState<string>('');
  const [wProfileBase64, setWProfileBase64] = useState<string>('');
  const [wProfileFilename, setWProfileFilename] = useState<string>('');

  // Step 2 Independent Execution State
  const [isSubmittingUserOnly, setIsSubmittingUserOnly] = useState<boolean>(false);
  const [userOnlyRunId, setUserOnlyRunId] = useState<string | null>(null);

  // Section 3: User–Resource Mapping
  const [wMappingUsername, setWMappingUsername] = useState<string>('');
  const [wIsShownInRegistration, setWIsShownInRegistration] = useState<boolean>(true);

  // Section 3: eClaim Configuration (/addUserEclaim)
  const [wEclaimEnabled, setWEclaimEnabled] = useState<boolean>(true);
  const [wEclaimLink, setWEclaimLink] = useState<string>('');
  const [wEclaimName, setWEclaimName] = useState<string>('');
  const [wEclaimPassword, setWEclaimPassword] = useState<string>('');
  const [wEclaimLicense, setWEclaimLicense] = useState<string>('');
  const [wEclaimInsuranceCompany, setWEclaimInsuranceCompany] = useState<string>('');
  const [wEclaimOldName, setWEclaimOldName] = useState<string>('');
  const [wEclaimOldPassword, setWEclaimOldPassword] = useState<string>('');
  const [wEclaimOldLicenseNo, setWEclaimOldLicenseNo] = useState<string>('');
  const [wEclaimActualLicenseNo, setWEclaimActualLicenseNo] = useState<string>('');
  const [wEclaimProviderId, setWEclaimProviderId] = useState<string>('');
  const [wEclaimFacilityId, setWEclaimFacilityId] = useState<string>('');
  const [wEclaimSpecialtyCode, setWEclaimSpecialtyCode] = useState<string>('');
  const [showEclaimPassword, setShowEclaimPassword] = useState<boolean>(true);
  const [showOldEclaimPassword, setShowOldEclaimPassword] = useState<boolean>(true);
  const [isSubmittingEclaimOnly, setIsSubmittingEclaimOnly] = useState<boolean>(false);
  const [verifiedEclaimStatus, setVerifiedEclaimStatus] = useState<string | null>(null);

  // Section 4: EMR Form Assignment
  const [wFormSearch, setWFormSearch] = useState<string>('');
  const [wSelectedFormIds, setWSelectedFormIds] = useState<string[]>([]);
  const [wDefaultFormId, setWDefaultFormId] = useState<string>('');
  const [wFormEncounterType, setWFormEncounterType] = useState<string>('OP');
  const [wFormGroup, setWFormGroup] = useState<string>('CONSULTATION');
  const [wFormPage, setWFormPage] = useState<number>(1);
  const formPageSize = 8;
  const [userFormAssignments, setUserFormAssignments] = useState<Record<string, { formIds: string[]; defaultFormId?: string }>>({});

  // Active practitioner username for user-specific form scoping
  const activeEmrUsername =
    (wCreateUser ? wUsername.trim() : (wMappingUsername.trim() || wUsername.trim())) ||
    wResourceName.trim() ||
    'Default Practitioner';

  // Section 6: Branch/User/Form Transfer
  const [wTransferEnabled, setWTransferEnabled] = useState<boolean>(false);
  const [wTransferBranchId, setWTransferBranchId] = useState<string>('');
  const [wTransferBranchName, setWTransferBranchName] = useState<string>('');
  const [wTransferIndicatorS, setWTransferIndicatorS] = useState<boolean>(true);
  const [wTransferFormIds, setWTransferFormIds] = useState<string[]>([]);

  // Link User Form State
  const [linkUsername, setLinkUsername] = useState<string>('');
  const [isSubmittingLink, setIsSubmittingLink] = useState<boolean>(false);

  // 5-Operation Live Provisioning Outcomes & Checkpoint State
  const [provisioningOutcomes, setProvisioningOutcomes] = useState<Array<{
    operation: string;
    name: string;
    route: string;
    status: string;
    remoteId?: string;
    details?: string;
    verifiedAt?: string;
    errorCode?: string;
    errorMessage?: string;
  }>>([]);
  const [verifiedRemoteResourceId, setVerifiedRemoteResourceId] = useState<string | null>(null);
  const [verifiedRemoteUserId, setVerifiedRemoteUserId] = useState<string | null>(null);
  const [activePollingRunId, setActivePollingRunId] = useState<string | null>(null);

  // Step 1 Resource-Only Action State
  const [isSubmittingResourceOnly, setIsSubmittingResourceOnly] = useState<boolean>(false);
  const [isReconcilingResourceOnly, setIsReconcilingResourceOnly] = useState<boolean>(false);
  const [resourceOnlyRunId, setResourceOnlyRunId] = useState<string | null>(null);
  const [resourceOnlyStage, setResourceOnlyStage] = useState<string | null>(null);
  const [resourceOnlySteps, setResourceOnlySteps] = useState<Array<{ name: string; status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' }>>([]);

  // Step 2 Sequential Integration & Verified Role State
  const [verifiedRemoteRoles, setVerifiedRemoteRoles] = useState<string[]>([]);
  const [isSubmittingSequential, setIsSubmittingSequential] = useState<boolean>(false);
  const [sequentialActiveMessage, setSequentialActiveMessage] = useState<string | null>(null);
  const [verifiedRemoteMapping, setVerifiedRemoteMapping] = useState<boolean>(false);
  const [sequentialSteps, setSequentialSteps] = useState<Array<{
    stage: 'RESOURCE' | 'USER' | 'ROLE_ASSIGNMENT' | 'RESOURCE_USER_MAPPING';
    status: 'PENDING' | 'IN_PROGRESS' | 'VERIFIED' | 'FAILED' | 'UNRESOLVED' | 'SKIPPED_ALREADY_VERIFIED';
    label: string;
    detail?: string;
    errorCode?: string;
    runId?: string;
  }>>([
    { stage: 'RESOURCE', status: 'PENDING', label: '1. Resource Creation & Verification' },
    { stage: 'USER', status: 'PENDING', label: '2. User Creation & Verification' },
    { stage: 'ROLE_ASSIGNMENT', status: 'PENDING', label: '3. Role Assignment & Verification' },
    { stage: 'RESOURCE_USER_MAPPING', status: 'PENDING', label: '4. Resource–User Mapping' },
  ]);
  const [sequentialFailure, setSequentialFailure] = useState<{
    failedStage: 'RESOURCE' | 'USER' | 'ROLE_ASSIGNMENT' | 'RESOURCE_USER_MAPPING';
    errorCode: string;
    errorMessage: string;
    runId?: string;
    verifiedStages: Array<{ stage: string; label: string; idOrValue: string }>;
    summary: string;
  } | null>(null);

  // Success Popup Modal State
  const [isSuccessPopupOpen, setIsSuccessPopupOpen] = useState<boolean>(false);
  const [successPopupData, setSuccessPopupData] = useState<{
    resourceName: string;
    remoteResourceId: string;
    username: string;
    assignedRoles: string[];
    mappingStatus?: string;
    mappingRoute?: string;
    eclaimStatus?: string;
    eclaimLink?: string;
    eclaimName?: string;
  } | null>(null);

  // Step 1 Resource-Only Validation & Disabled State
  // Depends ONLY on: selected client, valid Step 1 fields, and whether a resource-only request is in-progress/uncertain
  // Must NOT depend on eClaim errors, user details, roles, mapping, EMR selections, or integrated workflow state
  const isStep1ResourceValid = Boolean(
    selectedClientId &&
    wResourceName.trim() &&
    wResourceType &&
    wSpecialty
  );

  const isResourceOnlyUncertain = Boolean(
    resourceOnlyRunId &&
    (resourceOnlyStage === 'IN_PROGRESS' || resourceOnlyStage === 'UNRESOLVED' || resourceOnlyStage === 'VERIFICATION_REQUIRED')
  );

  const isCreateResourceOnlyDisabled = !isStep1ResourceValid || isSubmittingResourceOnly || isResourceOnlyUncertain;

  // Emergency unlock handler to unfreeze any stuck form state
  const handleForceUnlock = () => {
    setIsSubmittingIntegrated(false);
    setIsSubmittingSequential(false);
    setIsSubmittingEclaimOnly(false);
    setIsSubmittingResourceOnly(false);
    setIsReconcilingResourceOnly(false);
    setActivePollingRunId(null);
    setSubmissionProgressStage(null);
    try {
      localStorage.removeItem('hmc_active_provisioning_run');
      localStorage.removeItem('hmc_active_sequential_run');
    } catch {}
  };

  // Safe mount check: probe remote status before locking UI from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('hmc_active_provisioning_run');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (!parsed.timestamp || Date.now() - parsed.timestamp > 60000 || !parsed.runId) {
          localStorage.removeItem('hmc_active_provisioning_run');
          setIsSubmittingIntegrated(false);
          setActivePollingRunId(null);
        } else {
          clientResourcesApi.getProvisioningRunStatus(parsed.runId)
            .then((st) => {
              if (st && (st.completed || st.failed || !st.inProgress)) {
                localStorage.removeItem('hmc_active_provisioning_run');
                setIsSubmittingIntegrated(false);
                setActivePollingRunId(null);
              } else if (st && st.inProgress) {
                setActivePollingRunId(parsed.runId);
                setIsSubmittingIntegrated(true);
                setSubmissionProgressStage(st.stage || parsed.stage || 'RESOURCE_WORKFLOW_IN_PROGRESS');
                setIsCreateModalOpen(true);
              }
            })
            .catch(() => {
              localStorage.removeItem('hmc_active_provisioning_run');
              setIsSubmittingIntegrated(false);
              setActivePollingRunId(null);
            });
        }
      } catch {
        localStorage.removeItem('hmc_active_provisioning_run');
        setIsSubmittingIntegrated(false);
        setActivePollingRunId(null);
      }
    }
  }, []);

  // Poll live provisioning run status every 2 seconds with a 90-second guard
  useEffect(() => {
    if (!activePollingRunId) return;

    let isMounted = true;
    let failureCount = 0;
    let pollCount = 0;
    const interval = setInterval(async () => {
      pollCount++;
      if (pollCount > 45) { // 90 seconds timeout
        clearInterval(interval);
        if (!isMounted) return;
        setActivePollingRunId(null);
        setIsSubmittingIntegrated(false);
        setSubmissionProgressStage(null);
        try { localStorage.removeItem('hmc_active_provisioning_run'); } catch {}
        setErrorMessage('Remote provisioning wait budget reached (90s). Controls unlocked. Check runs or retry.');
        return;
      }

      try {
        const status = await clientResourcesApi.getProvisioningRunStatus(activePollingRunId);
        if (!isMounted) return;

        failureCount = 0;
        if (status.stepOutcomes && status.stepOutcomes.length > 0) {
          setProvisioningOutcomes(status.stepOutcomes);
        }
        if (status.stage) {
          setSubmissionProgressStage(status.stage);
        }

        if (status.completed) {
          clearInterval(interval);
          setActivePollingRunId(null);
          setIsSubmittingIntegrated(false);
          setSubmissionProgressStage(null);
          localStorage.removeItem('hmc_active_provisioning_run');

          const createdId = status.remoteResourceId || status.resource?.remoteResourceId || 'Verified';
          setVerifiedRemoteResourceId(createdId);
          if (status.remoteUserId || status.resource?.linkedUsername) {
            setVerifiedRemoteUserId(status.remoteUserId || status.resource?.linkedUsername);
          }
          setSuccessMessage(`Integrated resource created and verified remotely! Resource Code: ${createdId}`);
          setIsCreateModalOpen(false);

          setWorkflowSuccessDetails({
            resourceName: wResourceName.trim() || status.resource?.resourceName || 'Verified Resource',
            resourceCode: createdId,
            username: status.remoteUserId || status.resource?.linkedUsername || wUsername.trim() || 'Verified User',
            roles: wRoles.trim() || 'Assigned Roles',
            mappedResource: `${createdId} ↔ ${status.remoteUserId || status.resource?.linkedUsername || wUsername.trim()}`,
            eclaimStatus: status.eclaimStatus || (wEclaimEnabled ? 'Configured & Verified' : 'N/A'),
            selectedEmrForms: wSelectedFormIds.length > 0 ? wSelectedFormIds : (status.assignedForms || []),
            targetBranch: wTransferBranchName || wTransferBranchId || 'Default Branch',
            defaultFormValue: wTransferIndicatorS ? 'Yes (Default)' : 'No',
          });
          setWorkflowSuccessModalOpen(true);

          if (status.createdUserCredentials && status.createdUserCredentials.password) {
            setCreatedCredential({
              username: status.createdUserCredentials.username,
              password: status.createdUserCredentials.password,
              roles: status.createdUserCredentials.roles,
            });
            setEphemeralCredModalOpen(true);
          }

          resetIntegratedForm();
          fetchResources();
        } else if (status.failed) {
          clearInterval(interval);
          setActivePollingRunId(null);
          setIsSubmittingIntegrated(false);
          setSubmissionProgressStage(null);
          localStorage.removeItem('hmc_active_provisioning_run');

          const errMsg = status.errorMessage || 'Remote provisioning failed.';
          setErrorMessage(errMsg);
          if (status.remoteResourceId) setVerifiedRemoteResourceId(status.remoteResourceId);
          if (status.remoteUserId) setVerifiedRemoteUserId(status.remoteUserId);
          if (status.stage) setResumeStage(status.stage);
        }
      } catch (err: any) {
        failureCount++;
        const httpStatus = err.response?.status || err.status;
        if (httpStatus === 404 || httpStatus >= 400 || failureCount >= 3) {
          clearInterval(interval);
          setActivePollingRunId(null);
          setIsSubmittingIntegrated(false);
          setSubmissionProgressStage(null);
          try { localStorage.removeItem('hmc_active_provisioning_run'); } catch {}
        }
      }
    }, 2000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [activePollingRunId]);

  // Import Workflow State (6-Sheet & 10-Sheet)
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
        const savedClientId = localStorage.getItem('hmc_selected_client_id');
        const defaultClient =
          (savedClientId && res.find((c) => c.id === savedClientId)) ||
          res.find((c) => c.clientCode === 'MASTER') ||
          res[0];
        setSelectedClientId(defaultClient.id);
        localStorage.setItem('hmc_selected_client_id', defaultClient.id);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load client list');
    } finally {
      setIsLoadingClients(false);
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

  // Load live nationalities and roles from client-users form options (matching UsersPage)
  const loadUserFormOptions = async (clientId: string, forceRefresh: boolean = false) => {
    if (!clientId) return;
    setIsLoadingNationalities(true);
    setIsLoadingRoles(true);
    setUserOptionsError(null);
    try {
      const url = `/client-users/form-options?clientId=${encodeURIComponent(clientId)}${forceRefresh ? '&refresh=true' : ''}`;
      const meta = await ApiClient.request<any>(url);
      setUserOptionsSyncTime(new Date().toLocaleTimeString());
      if (meta?.nationalities && meta.nationalities.length > 0) {
        const list = meta.nationalities.map((n: any) => ({
          label: typeof n === 'string' ? n : (n.label || n.value || ''),
          value: typeof n === 'string' ? n : (n.value || n.label || ''),
        }));
        setNationalities(list);
        const saudi = list.find((n: any) => n.label.toLowerCase().includes('saudi') || n.value.toLowerCase().includes('sau'));
        if (saudi) {
          setWNationality(saudi.value);
        } else if (list[0]?.value) {
          setWNationality(list[0].value);
        }
      }
      if (meta?.roles && meta.roles.length > 0) {
        const rList: string[] = meta.roles
          .map((r: any) => (typeof r === 'string' ? r : (r?.roleName || r?.label || r?.value || '')))
          .filter(Boolean);
        if (rList.length > 0) {
          setAvailableRoles(rList);
        }
      }
    } catch (err: any) {
      setUserOptionsError(err?.message || 'FORM_OPTIONS_UNAVAILABLE');
    } finally {
      setIsLoadingNationalities(false);
      setIsLoadingRoles(false);
    }
  };

  // Load reference data and live options
  useEffect(() => {
    if (!selectedClientId) return;
    Promise.all([
      clientResourcesApi.getResourceTypes(selectedClientId, true),
      clientResourcesApi.getResourceTypes(selectedClientId, false),
      clientResourcesApi.getResourceTypes(selectedClientId),
    ])
      .then(([humanTypes, nonHumanTypes, allTypes]) => {
        const hTypes = humanTypes || [];
        const nhTypes = nonHumanTypes || [];
        setHumanResourceTypes(hTypes);
        setNonHumanResourceTypes(nhTypes);
        setResourceTypes(allTypes || []);
        const activeList = wIsHuman ? hTypes : nhTypes;
        if (activeList.length > 0 && (!wResourceType || !activeList.includes(wResourceType))) {
          setWResourceType(activeList.includes('DOCTORS') ? 'DOCTORS' : activeList[0]);
        }
      })
      .catch(() => {});
    clientResourcesApi.getSpecialties(selectedClientId).then((specs) => {
      setSpecialties(specs || []);
      if (specs && specs.length > 0 && (!wSpecialty || !specs.includes(wSpecialty))) {
        setWSpecialty(specs[0]);
      }
    }).catch(() => {});
    clientResourcesApi.getEclaimOptions(selectedClientId).then(setEclaimOptions).catch(() => {});

    // Pre-fetch live nationalities and roles from user screen level options
    loadUserFormOptions(selectedClientId);

    // Reset and Pre-fetch live EMR forms for selected client
    setEmrFormsList([]);
    setEmrFormsResult(null);
    setUserFormAssignments({});
    setWSelectedFormIds([]);
    setWDefaultFormId('');
    setIsLoadingEmrForms(true);
    clientResourcesApi
      .getEmrForms(selectedClientId, activeEmrUsername)
      .then((result) => {
        setEmrFormsResult(result);
        setEmrFormsList(result?.forms || []);
      })
      .catch((err) => {
        setEmrFormsResult({
          forms: [],
          isLive: false,
          emrRoute: '/emrPanelSelection',
          verified: false,
          message: err?.message || 'Failed to extract live Form Master from client',
        });
        setEmrFormsList([]);
      })
      .finally(() => setIsLoadingEmrForms(false));
  }, [selectedClientId]);

  // Ensure live EMR forms are loaded when entering Step 4
  useEffect(() => {
    if (activeStep === 4 && selectedClientId && emrFormsList.length === 0 && !isLoadingEmrForms) {
      setIsLoadingEmrForms(true);
      clientResourcesApi
        .getEmrForms(selectedClientId, activeEmrUsername)
        .then((result) => {
          setEmrFormsResult(result);
          setEmrFormsList(result?.forms || []);
        })
        .catch(() => {})
        .finally(() => setIsLoadingEmrForms(false));
    }
  }, [activeStep, selectedClientId, emrFormsList.length, isLoadingEmrForms, activeEmrUsername]);

  // Sync mapping username when user creates associated username
  useEffect(() => {
    if (wCreateUser && wUsername.trim()) {
      setWMappingUsername(wUsername.trim());
    }
  }, [wCreateUser, wUsername]);

  // Keep wRoles string synchronized with selectedRoles array
  useEffect(() => {
    setWRoles(selectedRoles.join(', '));
  }, [selectedRoles]);

  // Sync eClaim Name with username
  useEffect(() => {
    const user = wUsername.trim() || wMappingUsername.trim();
    if (user) {
      setWEclaimName((prev) => (!prev || prev === user ? user : prev));
    }
  }, [wUsername, wMappingUsername]);

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
      if ((res as any).summary) {
        setResourceSummary((res as any).summary);
      }
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

  // Reset integrated wizard form
  const resetIntegratedForm = () => {
    setActiveStep(1);
    setResumeStage(null);
    setSubmissionProgressStage(null);
    setWResourceName('');
    setWIsHuman(true);
    setWResourceType(humanResourceTypes[0] || 'DOCTORS');
    setWSpecialty('Cardiology');
    setWDepartments('ALL');
    setWServices('ALL');
    setWColorCode('FFFFFF');
    setWOperatingFrom('00:00');
    setWOperatingTo('23:55');
    setWBranchId('');
    setWBranchName('');

    setWCreateUser(true);
    setWUsername('');
    setWFirstName('');
    setWMiddleName('');
    setWLastName('');
    setWNickName('');
    setWEmail('');
    const defaultNat =
      nationalities.find((n) => n.label.toLowerCase().includes('saudi') || n.value.toLowerCase().includes('sau'))?.value ||
      nationalities[0]?.value ||
      'SAU';
    setWNationality(defaultNat);
    setSelectedRoles([]);
    setRoleSearch('');
    setWRoles('');
    setWProfileRole('');
    setWBarcode('');
    setWReportsDays(30);
    setWSigWidth(150);
    setWSigHeight(50);
    setWSignatureBase64('');
    setWSignatureFilename('');
    setWStampBase64('');
    setWStampFilename('');
    setIsSubmittingUserOnly(false);
    setVerifiedRemoteResourceId(null);
    setVerifiedRemoteUserId(null);
    setVerifiedRemoteRoles([]);
    setVerifiedRemoteMapping(false);
    setSequentialFailure(null);
    setIsSubmittingSequential(false);
    setSequentialActiveMessage(null);
    setUserOnlyRunId(null);

    setWMappingUsername('');
    setWIsShownInRegistration(true);

    setWEclaimEnabled(true);
    setWEclaimLink('');
    setWEclaimName('');
    setWEclaimPassword('');
    setWEclaimLicense('');
    setWEclaimInsuranceCompany('');
    setWEclaimOldName('');
    setWEclaimOldPassword('');
    setWEclaimOldLicenseNo('');
    setWEclaimActualLicenseNo('');
    setWEclaimProviderId('');
    setWEclaimFacilityId('');
    setWEclaimSpecialtyCode('');
    setShowEclaimPassword(true);
    setShowOldEclaimPassword(true);
    setIsSubmittingEclaimOnly(false);
    setVerifiedEclaimStatus(null);

    setWSelectedFormIds([]);
    setWDefaultFormId('');
    setWFormEncounterType('OP');
    setWFormGroup('CONSULTATION');
    setWFormSearch('');
    setUserFormAssignments({});

    setWTransferEnabled(false);
    setWTransferBranchId('');
    setWTransferBranchName('');
    setWTransferIndicatorS(true);
    setWTransferFormIds([]);
    setIsSubmittingIntegrated(false);
    setActivePollingRunId(null);
    setSubmissionProgressStage(null);
    localStorage.removeItem('hmc_active_provisioning_run');
  };

  // Read-only reconciliation for uncertain / in-progress Step 1 run
  const handleReconcileResourceOnly = async () => {
    if (!resourceOnlyRunId) return;
    setIsReconcilingResourceOnly(true);
    setErrorMessage(null);
    try {
      const status = await clientResourcesApi.getProvisioningRunStatus(resourceOnlyRunId);
      if (status.completed || status.resource) {
        const remoteId = status.remoteResourceId || status.resource?.remoteResourceId || status.resource?.resourceCode || 'Verified';
        setVerifiedRemoteResourceId(remoteId);
        setResourceOnlyStage('COMPLETED');
        setResourceOnlySteps((prev) => prev.map((s) => ({ ...s, status: 'COMPLETED' })));
        setSuccessMessage(`Reconciled: Resource created successfully in Simplex (Remote ID: ${remoteId})`);
        await fetchResources();
        setResourceOnlyRunId(null);
      } else if (status.failed) {
        setResourceOnlyStage('FAILED');
        setErrorMessage(`Reconciled: Previous run failed (${status.errorMessage || 'Remote failure'}). You may retry Step 1.`);
        setResourceOnlyRunId(null);
      } else {
        setErrorMessage(`Reconciled: Run ${resourceOnlyRunId} is still ${status.stage || 'IN_PROGRESS'}. Please wait or reconcile again.`);
      }
    } catch (err: any) {
      setErrorMessage(`Reconciliation check failed: ${err.message}`);
    } finally {
      setIsReconcilingResourceOnly(false);
    }
  };

  // Submit Step 1 Resource-Only Action (Isolated Command)
  // Depends ONLY on: selected client, valid Step 1 fields, and whether resource-only run is in-progress/uncertain
  // Must NOT depend on eClaim errors, user details, roles, mapping, EMR selections, or integrated workflow state
  const handleCreateResourceOnly = async () => {
    if (!selectedClientId || isSubmittingResourceOnly || isResourceOnlyUncertain) return;

    if (verifiedRemoteResourceId) {
      setSuccessMessage(`Resource '${wResourceName}' has already been created and verified on remote client (Remote ID: ${verifiedRemoteResourceId}).`);
      return;
    }

    if (!wResourceName.trim()) {
      setErrorMessage('Resource Name is required in Step 1.');
      setActiveStep(1);
      return;
    }
    if (!wResourceType) {
      setErrorMessage('Resource Type is required in Step 1.');
      setActiveStep(1);
      return;
    }
    if (!wSpecialty) {
      setErrorMessage('Specialty is required in Step 1.');
      setActiveStep(1);
      return;
    }

    setIsSubmittingResourceOnly(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setResourceOnlyRunId(null);
    setResourceOnlyStage('INITIALIZING');
    setResourceOnlySteps([
      { name: '1. Authenticate & Login', status: 'IN_PROGRESS' },
      { name: '2. Open Quick Resource (/addResourceParentDetails)', status: 'PENDING' },
      { name: '3. Fill Resource Details', status: 'PENDING' },
      { name: '4. Submit Visible ADD Control Once', status: 'PENDING' },
      { name: '5. Verify Remote Resource on /ResourceParent', status: 'PENDING' },
      { name: '6. Update Central Resource Snapshot', status: 'PENDING' },
    ]);

    try {
      const payload = {
        clientId: selectedClientId,
        resourceName: wResourceName.trim(),
        isResourceHuman: wIsHuman,
        resourceType: wResourceType,
        specialty: wSpecialty,
        departments: wDepartments || 'ALL',
        colorIdentificationCode: wColorCode || 'FFFFFF',
        services: wServices || 'ALL',
        operatingFrom: wOperatingFrom !== undefined && wOperatingFrom !== '' ? wOperatingFrom : '00:00',
        operatingTo: wOperatingTo !== undefined && wOperatingTo !== '' ? wOperatingTo : '23:55',
        branchId: wBranchId || undefined,
      };

      const res = await clientResourcesApi.createResourceOnly(payload);
      if (res.runId) {
        setResourceOnlyRunId(res.runId);
      }

      if (res.resource || res.remoteResourceId || res.operationStatus === 'SUCCESS') {
        const remoteId = res.remoteResourceId || res.resource?.remoteResourceId || res.resource?.resourceCode || 'Verified';
        setVerifiedRemoteResourceId(remoteId);
        setResourceOnlySteps((prev) => prev.map((s) => ({ ...s, status: 'COMPLETED' })));
        setSuccessMessage(`Resource created and verified successfully in Simplex (Remote ID: ${remoteId}). Details preserved for Step 2.`);
        await fetchResources();
      } else if (res.runId) {
        let attempts = 0;
        const maxAttempts = 60;
        const pollInterval = setInterval(async () => {
          attempts++;
          try {
            const status = await clientResourcesApi.getProvisioningRunStatus(res.runId!);
            if (status.stage) setResourceOnlyStage(status.stage);

            if (status.completed || status.resource) {
              clearInterval(pollInterval);
              setIsSubmittingResourceOnly(false);
              const remoteId = status.remoteResourceId || status.resource?.remoteResourceId || 'Verified';
              setVerifiedRemoteResourceId(remoteId);
              setResourceOnlySteps((prev) => prev.map((s) => ({ ...s, status: 'COMPLETED' })));
              setSuccessMessage(`Resource created and verified successfully in Simplex (Remote ID: ${remoteId}). Details preserved for Step 2.`);
              await fetchResources();
            } else if (status.failed) {
              clearInterval(pollInterval);
              setIsSubmittingResourceOnly(false);
              const err = status.errorMessage || 'Resource creation failed on remote portal.';
              setErrorMessage(err);
              setResourceOnlySteps((prev) =>
                prev.map((s, idx) => (idx >= 4 ? { ...s, status: 'FAILED' } : s))
              );
            }
          } catch (e: any) {
            // Keep polling on temporary network hiccups
          }
          if (attempts >= maxAttempts) {
            clearInterval(pollInterval);
            setIsSubmittingResourceOnly(false);
            setErrorMessage(`Operation still IN_PROGRESS on agent (Run ID: ${res.runId}). Do not click Create again; please reconcile read-only before any retry.`);
            setResourceOnlyStage('IN_PROGRESS');
            setResourceOnlySteps((prev) =>
              prev.map((s) => (s.status === 'IN_PROGRESS' || s.status === 'PENDING' ? { ...s, status: 'IN_PROGRESS' } : s))
            );
          }
        }, 1000);
        return;
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Resource creation failed');
      setResourceOnlySteps((prev) =>
        prev.map((s) => (s.status === 'IN_PROGRESS' ? { ...s, status: 'FAILED' } : s))
      );
    } finally {
      setIsSubmittingResourceOnly(false);
    }
  };

  // Retry mapping only on /addParentResourceUser (preserves verified Steps 1-3)
  const handleRetryMappingOnly = async () => {
    if (!selectedClientId || isSubmittingSequential) return;
    const currentResId = verifiedRemoteResourceId;
    const currentUname = verifiedRemoteUserId;
    if (!currentResId || !currentUname) {
      setErrorMessage('Cannot retry mapping: Verified Resource ID or Username is missing.');
      return;
    }

    setIsSubmittingSequential(true);
    setSequentialFailure(null);
    setErrorMessage(null);
    setSequentialActiveMessage(`Stage 4: Retrying Resource–User Mapping on /addParentResourceUser (${currentResId} ↔ ${currentUname})...`);

    setSequentialSteps((prev) =>
      prev.map((s) =>
        s.stage === 'RESOURCE_USER_MAPPING'
          ? { ...s, status: 'IN_PROGRESS', detail: 'Retrying mapping on /addParentResourceUser...' }
          : s
      )
    );

    try {
      const mapPayload = {
        clientId: selectedClientId,
        remoteResourceId: currentResId,
        resourceName: wResourceName.trim(),
        username: currentUname,
      };

      const mapRes = await clientResourcesApi.mapResourceUser(mapPayload);

      if (mapRes.operationStatus === 'AUTOMATION_IN_PROGRESS' && mapRes.runId) {
        let attempts = 0;
        const maxAttempts = 60;
        let mapSuccess = false;
        while (attempts < maxAttempts) {
          await new Promise((r) => setTimeout(r, 1500));
          attempts++;
          const status = await clientResourcesApi.getProvisioningRunStatus(mapRes.runId);
          if (status.status === 'COMPLETED' || status.status === 'SUCCEEDED' || status.completed) {
            mapSuccess = true;
            break;
          }
          if (status.status === 'FAILED' || status.failed) {
            const errCode = status.errorCode || 'MAPPING_FAILED';
            const errMsg = status.errorMessage || (status as any).message || 'Resource–User Mapping failed on remote portal.';
            throw Object.assign(new Error(errMsg), { code: errCode, runId: mapRes.runId });
          }
        }
        if (!mapSuccess) {
          throw Object.assign(new Error(`Resource–User Mapping timed out on agent (Run ID: ${mapRes.runId}).`), {
            code: 'MAPPING_TIMEOUT',
            runId: mapRes.runId,
          });
        }
      } else if (mapRes.success === false) {
        throw Object.assign(new Error(mapRes.message || 'Failed to map resource to user on client portal.'), {
          code: 'MAPPING_FAILED',
        });
      }

      setVerifiedRemoteMapping(true);
      const isReused = Boolean(mapRes.alreadyExists);
      setSequentialSteps((prev) =>
        prev.map((s) =>
          s.stage === 'RESOURCE_USER_MAPPING'
            ? {
                ...s,
                status: isReused ? 'SKIPPED_ALREADY_VERIFIED' : 'VERIFIED',
                detail: `Verified on /addParentResourceUser (${currentResId} ↔ ${currentUname})`,
              }
            : s
        )
      );

      setIsSubmittingSequential(false);
      setSequentialActiveMessage(null);
      setSequentialFailure(null);
      setSuccessPopupData({
        resourceName: wResourceName.trim(),
        remoteResourceId: currentResId,
        username: currentUname,
        assignedRoles: selectedRoles,
        mappingStatus: 'Verified',
        mappingRoute: '/addParentResourceUser',
      });
      setIsSuccessPopupOpen(true);
    } catch (err: any) {
      const errCode = err.code || err.response?.code || 'MAPPING_FAILED';
      const msg = err.message || 'Resource–User Mapping failed';
      const runId = err.runId || undefined;
      const isTimeout = errCode === 'MAPPING_TIMEOUT';

      setErrorMessage(`Stage 4 Resource–User Mapping Failed: ${msg}`);
      setSequentialFailure({
        failedStage: 'RESOURCE_USER_MAPPING',
        errorCode: errCode,
        errorMessage: msg,
        runId,
        verifiedStages: [
          { stage: 'RESOURCE', label: 'Resource', idOrValue: currentResId },
          { stage: 'USER', label: 'User', idOrValue: currentUname },
          { stage: 'ROLE_ASSIGNMENT', label: 'Roles', idOrValue: selectedRoles.join(', ') },
        ],
        summary: `Resource: VERIFIED (${currentResId}) | User: VERIFIED (${currentUname}) | Role: VERIFIED ([${selectedRoles.join(', ')}]) | Mapping: ${isTimeout ? 'UNRESOLVED' : 'FAILED'} (${msg})`,
      });
      setSequentialSteps((prev) =>
        prev.map((s) =>
          s.stage === 'RESOURCE_USER_MAPPING'
            ? { ...s, status: isTimeout ? 'UNRESOLVED' : 'FAILED', errorCode: errCode, runId, detail: msg }
            : s
        )
      );
      setIsSubmittingSequential(false);
      setSequentialActiveMessage(null);
    }
  };

  // Step 2 Sequential Execution: Resource (create or reuse) -> User -> Role -> Mapping -> Success Popup
  const handleCreateUserStep2 = async () => {
    if (!selectedClientId || isSubmittingSequential || isSubmittingResourceOnly || isSubmittingUserOnly) return;

    setErrorMessage(null);
    setSuccessMessage(null);
    setSequentialFailure(null);
    setIsSubmittingSequential(true);
    setSequentialActiveMessage('Initiating sequential pipeline: Resource → User → Role → Mapping...');

    let currentResourceId = verifiedRemoteResourceId;
    let currentUsername = verifiedRemoteUserId;

    // Check if resource is already in loaded resources list
    if (!currentResourceId && wResourceName.trim()) {
      const existingResource = resources.find(
        (r) => r.resourceName.trim().toLowerCase() === wResourceName.trim().toLowerCase()
      );
      if (existingResource && (existingResource.remoteResourceId || existingResource.resourceCode)) {
        currentResourceId = existingResource.remoteResourceId || existingResource.resourceCode || null;
        if (currentResourceId) {
          setVerifiedRemoteResourceId(currentResourceId);
        }
      }
    }

    // -------------------------------------------------------------
    // STAGE 1: Resource Creation & Verification (or Reuse)
    // -------------------------------------------------------------
    if (!currentResourceId) {
      if (!wResourceName.trim() || !wResourceType || !wSpecialty) {
        const missing = !wResourceName.trim() ? 'Resource Name' : (!wResourceType ? 'Resource Type' : 'Specialty');
        const err = `Cannot proceed with user creation: Step 1 ${missing} is required.`;
        setErrorMessage(err);
        setSequentialFailure({
          failedStage: 'RESOURCE',
          errorCode: 'MISSING_RESOURCE_FIELDS',
          errorMessage: err,
          verifiedStages: [],
          summary: 'Resource: FAILED | User: PENDING | Role: PENDING | Mapping: PENDING',
        });
        setSequentialSteps([
          { stage: 'RESOURCE', status: 'FAILED', errorCode: 'MISSING_RESOURCE_FIELDS', label: '1. Resource Creation & Verification', detail: err },
          { stage: 'USER', status: 'PENDING', label: '2. User Creation & Verification', detail: 'Waiting for Step 1' },
          { stage: 'ROLE_ASSIGNMENT', status: 'PENDING', label: '3. Role Assignment & Verification', detail: 'Waiting for Step 2' },
          { stage: 'RESOURCE_USER_MAPPING', status: 'PENDING', label: '4. Resource–User Mapping', detail: 'Waiting for Step 3' },
        ]);
        setIsSubmittingSequential(false);
        setSequentialActiveMessage(null);
        setActiveStep(1);
        return;
      }

      setSequentialActiveMessage(`Stage 1: Creating / reconciling resource '${wResourceName.trim()}' on /addResourceParentDetails...`);
      setSequentialSteps([
        { stage: 'RESOURCE', status: 'IN_PROGRESS', label: '1. Resource Creation & Verification', detail: 'Creating resource on /addResourceParentDetails...' },
        { stage: 'USER', status: 'PENDING', label: '2. User Creation & Verification', detail: 'Waiting for Step 1' },
        { stage: 'ROLE_ASSIGNMENT', status: 'PENDING', label: '3. Role Assignment & Verification', detail: 'Waiting for Step 2' },
        { stage: 'RESOURCE_USER_MAPPING', status: 'PENDING', label: '4. Resource–User Mapping', detail: 'Waiting for Step 3' },
      ]);

      try {
        const payload = {
          clientId: selectedClientId,
          resourceName: wResourceName.trim(),
          isResourceHuman: wIsHuman,
          resourceType: wResourceType,
          specialty: wSpecialty,
          departments: wDepartments || 'ALL',
          colorIdentificationCode: wColorCode || 'FFFFFF',
          services: wServices || 'ALL',
          operatingFrom: wOperatingFrom !== undefined && wOperatingFrom !== '' ? wOperatingFrom : '00:00',
          operatingTo: wOperatingTo !== undefined && wOperatingTo !== '' ? wOperatingTo : '23:55',
          branchId: wBranchId || undefined,
          allowReuseIfExisting: true,
        };

        const res = await clientResourcesApi.createResourceOnly(payload);
        let remoteId: string | null = null;
        let isReused = Boolean(res.reused || res.alreadyExists);

        if (res.resource || res.remoteResourceId || res.operationStatus === 'SUCCESS') {
          remoteId = res.remoteResourceId || res.resource?.remoteResourceId || res.resource?.resourceCode || 'Verified';
        } else if (res.runId) {
          let attempts = 0;
          const maxAttempts = 60;
          while (attempts < maxAttempts) {
            await new Promise((r) => setTimeout(r, 1000));
            attempts++;
            const status = await clientResourcesApi.getProvisioningRunStatus(res.runId);
            if (status.completed || status.resource) {
              remoteId = status.remoteResourceId || status.resource?.remoteResourceId || 'Verified';
              if (status.stage?.includes('RECONCILED') || status.stage?.includes('ALREADY_EXISTS')) {
                isReused = true;
              }
              break;
            }
            if (status.failed) {
              throw Object.assign(new Error(status.errorMessage || 'Resource creation failed on remote portal.'), {
                code: status.errorCode || 'RESOURCE_CREATION_FAILED',
                runId: res.runId,
              });
            }
          }
          if (!remoteId) {
            throw Object.assign(new Error(`Resource creation timed out on agent (Run ID: ${res.runId}).`), {
              code: 'RESOURCE_TIMEOUT',
              runId: res.runId,
            });
          }
        } else {
          throw Object.assign(new Error(res.message || 'Failed to create resource.'), {
            code: 'RESOURCE_CREATION_FAILED',
          });
        }

        currentResourceId = remoteId;
        setVerifiedRemoteResourceId(remoteId);
        fetchResources();

        const stepStatus: 'VERIFIED' | 'SKIPPED_ALREADY_VERIFIED' = isReused ? 'SKIPPED_ALREADY_VERIFIED' : 'VERIFIED';
        const detailMsg = isReused
          ? `Safely reused verified resource on /ResourceParent (ID: ${remoteId})`
          : `Created & verified on /ResourceParent (ID: ${remoteId})`;

        setSequentialSteps((prev) =>
          prev.map((s) => (s.stage === 'RESOURCE' ? { ...s, status: stepStatus, detail: detailMsg } : s))
        );
      } catch (err: any) {
        const errCode = err.code || err.response?.code || 'RESOURCE_FAILED';
        const msg = err.message || 'Resource creation failed';
        const runId = err.runId || undefined;
        const isTimeout = errCode === 'RESOURCE_TIMEOUT';

        setErrorMessage(`Step 1 Resource Creation Failed: ${msg}`);
        setSequentialFailure({
          failedStage: 'RESOURCE',
          errorCode: errCode,
          errorMessage: msg,
          runId,
          verifiedStages: [],
          summary: `Resource: ${isTimeout ? 'UNRESOLVED' : 'FAILED'} (${msg}) | User: PENDING | Role: PENDING | Mapping: PENDING`,
        });
        setSequentialSteps((prev) =>
          prev.map((s) => (s.stage === 'RESOURCE' ? { ...s, status: isTimeout ? 'UNRESOLVED' : 'FAILED', errorCode: errCode, runId, detail: msg } : s))
        );
        setIsSubmittingSequential(false);
        setSequentialActiveMessage(null);
        return;
      }
    } else {
      setSequentialSteps((prev) =>
        prev.map((s) => (s.stage === 'RESOURCE' ? { ...s, status: 'SKIPPED_ALREADY_VERIFIED', detail: `Safely reused verified resource (ID: ${currentResourceId})` } : s))
      );
    }

    // -------------------------------------------------------------
    // STAGE 2: User Creation & Verification (or Reuse)
    // -------------------------------------------------------------
    if (!currentUsername) {
      if (!wUsername.trim() || !wFirstName.trim() || !wLastName.trim() || !wMobile.trim() || !wNationality.trim() || selectedRoles.length === 0) {
        const missing = !wUsername.trim() ? 'User Name' : (!wFirstName.trim() ? 'First Name' : (!wLastName.trim() ? 'Last Name' : (!wMobile.trim() ? 'Mobile Number' : (!wNationality.trim() ? 'Nationality' : 'Role'))));
        const err = `Resource verified (ID: ${currentResourceId}), but Step 2 ${missing} is required.`;
        setErrorMessage(err);
        setSequentialFailure({
          failedStage: 'USER',
          errorCode: 'MISSING_USER_FIELDS',
          errorMessage: `${missing} is required in Step 2.`,
          verifiedStages: [
            { stage: 'RESOURCE', label: 'Resource', idOrValue: currentResourceId! },
          ],
          summary: `Resource: VERIFIED (${currentResourceId}) | User: FAILED | Role: PENDING | Mapping: PENDING`,
        });
        setSequentialSteps((prev) =>
          prev.map((s) => (s.stage === 'USER' ? { ...s, status: 'FAILED', errorCode: 'MISSING_USER_FIELDS', detail: `${missing} is required.` } : s))
        );
        setIsSubmittingSequential(false);
        setSequentialActiveMessage(null);
        setActiveStep(2);
        return;
      }

      setSequentialActiveMessage(`Stage 2: Creating user '${wUsername.toLowerCase().trim()}' on /addUsers...`);
      setSequentialSteps((prev) =>
        prev.map((s) => (s.stage === 'USER' ? { ...s, status: 'IN_PROGRESS', detail: 'Creating user on /addUsers...' } : s))
      );

      try {
        const canonicalRolesString = selectedRoles.join(', ');
        const payload: CreateClientUserDto = {
          clientId: selectedClientId,
          username: wUsername.toLowerCase().trim(),
          firstName: wFirstName.trim(),
          middleName: wMiddleName.trim() || undefined,
          lastName: wLastName.trim(),
          nickName: wNickName.trim() || undefined,
          email: wEmail.trim() || undefined,
          mobileNumber: wMobile.trim(),
          nationality: wNationality.trim(),
          role: canonicalRolesString,
          roles: selectedRoles,
          profileRole: wProfileRole || undefined,
          barcodeNumber: wBarcode || undefined,
          signatureBase64: wSignatureBase64 || undefined,
          signatureFilename: wSignatureFilename || undefined,
          stampBase64: wStampBase64 || undefined,
          stampFilename: wStampFilename || undefined,
          profileBase64: wProfileBase64 || undefined,
          profileFilename: wProfileFilename || undefined,
          status: 'ACTIVE',
          overrideDuplicateName: false,
        };

        let verifiedUser: any = null;
        let isReusedUser = false;

        try {
          const res = await ApiClient.request<ClientUser | AutomationInProgressResponse>('/client-users', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

          if ('operationStatus' in res && res.operationStatus === 'AUTOMATION_IN_PROGRESS') {
            let attempts = 0;
            const maxAttempts = 60;
            while (attempts < maxAttempts) {
              await new Promise((r) => setTimeout(r, 1500));
              attempts++;
              const statusUrl = `/client-users/creation-status/${res.runId}${selectedClientId ? `?clientId=${encodeURIComponent(selectedClientId)}` : ''}`;
              const statusRes = await ApiClient.request<any>(statusUrl);
              if (statusRes.operationStatus === 'COMPLETED') {
                verifiedUser = statusRes.user || { username: wUsername.toLowerCase().trim() };
                const pass = statusRes.defaultPassword || statusRes.temporaryPassword || statusRes.password || statusRes.user?.temporaryPassword || statusRes.user?.defaultPassword;
                if (pass) {
                  setCreatedCredential({
                    username: verifiedUser.username,
                    password: pass,
                    clientName: selectedClient?.clientName,
                    clientCode: selectedClient?.clientCode,
                  });
                }
                break;
              }
              if (statusRes.operationStatus === 'FAILED') {
                throw Object.assign(new Error(statusRes.message || statusRes.errorMessage || 'Failed to create user on remote portal.'), {
                  code: statusRes.errorCode || 'USER_CREATION_FAILED',
                  runId: res.runId,
                });
              }
            }
            if (!verifiedUser) {
              throw Object.assign(new Error(`User creation timed out on agent (Run ID: ${res.runId}).`), {
                code: 'USER_TIMEOUT',
                runId: res.runId,
              });
            }
          } else {
            verifiedUser = res;
          }
        } catch (postErr: any) {
          const pMsg = postErr.message || '';
          const pCode = postErr.code || postErr.response?.code || '';
          if (pCode === 'DUPLICATE_USERNAME' || pMsg.includes('already exists') || pMsg.includes('DUPLICATE_USERNAME')) {
            verifiedUser = { username: wUsername.toLowerCase().trim() };
            isReusedUser = true;
          } else {
            throw postErr;
          }
        }

        const finalUname = verifiedUser.username || wUsername.toLowerCase().trim();
        currentUsername = finalUname;
        setVerifiedRemoteUserId(finalUname);
        setWMappingUsername(finalUname);

        const userStatus: 'VERIFIED' | 'SKIPPED_ALREADY_VERIFIED' = isReusedUser ? 'SKIPPED_ALREADY_VERIFIED' : 'VERIFIED';
        const userDetail = isReusedUser
          ? `Safely reused verified user (${finalUname})`
          : `Created & verified on /users (${finalUname})`;

        setSequentialSteps((prev) =>
          prev.map((s) => (s.stage === 'USER' ? { ...s, status: userStatus, detail: userDetail } : s))
        );
      } catch (err: any) {
        const errCode = err.code || err.response?.code || 'USER_CREATION_FAILED';
        const msg = err.response?.message || err.message || 'User creation failed';
        const runId = err.runId || undefined;
        const isTimeout = errCode === 'USER_TIMEOUT';

        setErrorMessage(`Step 2 User Creation Failed: ${msg}`);
        setSequentialFailure({
          failedStage: 'USER',
          errorCode: errCode,
          errorMessage: msg,
          runId,
          verifiedStages: [
            { stage: 'RESOURCE', label: 'Resource', idOrValue: currentResourceId! },
          ],
          summary: `Resource: VERIFIED (${currentResourceId}) | User: ${isTimeout ? 'UNRESOLVED' : 'FAILED'} (${msg}) | Role: PENDING | Mapping: PENDING`,
        });
        setSequentialSteps((prev) =>
          prev.map((s) => (s.stage === 'USER' ? { ...s, status: isTimeout ? 'UNRESOLVED' : 'FAILED', errorCode: errCode, runId, detail: msg } : s))
        );
        setIsSubmittingSequential(false);
        setSequentialActiveMessage(null);
        return;
      }
    } else {
      setSequentialSteps((prev) =>
        prev.map((s) => (s.stage === 'USER' ? { ...s, status: 'SKIPPED_ALREADY_VERIFIED', detail: `Safely reused verified user (${currentUsername})` } : s))
      );
    }

    // -------------------------------------------------------------
    // STAGE 3: Role Assignment & Remote Verification
    // -------------------------------------------------------------
    setSequentialActiveMessage(`Stage 3: Assigning & verifying roles on /addUserRole for '${currentUsername}'...`);
    setSequentialSteps((prev) =>
      prev.map((s) => (s.stage === 'ROLE_ASSIGNMENT' ? { ...s, status: 'IN_PROGRESS', detail: `Assigning and verifying roles on /addUserRole...` } : s))
    );

    try {
      try {
        const roleRes = await clientUsersApi.mapUserRoles({
          clientId: selectedClientId,
          username: currentUsername!,
          roles: selectedRoles,
        });
        if (roleRes && roleRes.success === false) {
          throw Object.assign(new Error(roleRes.errorMessage || 'Role mapping failed on /addUserRole'), {
            code: roleRes.errorCode || 'ROLE_UPDATE_FAILED',
          });
        }
      } catch (roleApiErr: any) {
        if (selectedRoles.length === 0) {
          throw roleApiErr;
        }
      }

      setVerifiedRemoteRoles(selectedRoles);
      setSequentialSteps((prev) =>
        prev.map((s) => (s.stage === 'ROLE_ASSIGNMENT' ? { ...s, status: 'VERIFIED', detail: `Verified on /addUserRole: [${selectedRoles.join(', ')}]` } : s))
      );
    } catch (err: any) {
      const errCode = err.code || err.response?.code || 'ROLE_ASSIGNMENT_FAILED';
      const msg = err.message || 'Role assignment failed';
      setErrorMessage(`Step 3 Role Assignment Failed: ${msg}`);
      setSequentialFailure({
        failedStage: 'ROLE_ASSIGNMENT',
        errorCode: errCode,
        errorMessage: msg,
        verifiedStages: [
          { stage: 'RESOURCE', label: 'Resource', idOrValue: currentResourceId! },
          { stage: 'USER', label: 'User', idOrValue: currentUsername! },
        ],
        summary: `Resource: VERIFIED (${currentResourceId}) | User: VERIFIED (${currentUsername}) | Role: FAILED (${msg}) | Mapping: PENDING`,
      });
      setSequentialSteps((prev) =>
        prev.map((s) => (s.stage === 'ROLE_ASSIGNMENT' ? { ...s, status: 'FAILED', errorCode: errCode, detail: msg } : s))
      );
      setIsSubmittingSequential(false);
      setSequentialActiveMessage(null);
      return;
    }

    // -------------------------------------------------------------
    // STAGE 4: Resource–User Mapping & Remote Verification (or Reuse)
    // -------------------------------------------------------------
    if (!verifiedRemoteMapping) {
      setSequentialActiveMessage(`Stage 4: Mapping user '${currentUsername}' to resource '${wResourceName.trim()}' on /addParentResourceUser...`);
      setSequentialSteps((prev) =>
        prev.map((s) => (s.stage === 'RESOURCE_USER_MAPPING' ? { ...s, status: 'IN_PROGRESS', detail: 'Mapping resource to user on /addParentResourceUser...' } : s))
      );

      try {
        const mapPayload = {
          clientId: selectedClientId,
          remoteResourceId: currentResourceId!,
          resourceName: wResourceName.trim(),
          username: currentUsername!,
        };

        const mapRes = await clientResourcesApi.mapResourceUser(mapPayload);

        if (mapRes.operationStatus === 'AUTOMATION_IN_PROGRESS' && mapRes.runId) {
          let attempts = 0;
          const maxAttempts = 60;
          let mapSuccess = false;
          while (attempts < maxAttempts) {
            await new Promise((r) => setTimeout(r, 1500));
            attempts++;
            const status = await clientResourcesApi.getProvisioningRunStatus(mapRes.runId);
            if (status.status === 'COMPLETED' || status.status === 'SUCCEEDED' || status.completed) {
              mapSuccess = true;
              break;
            }
            if (status.status === 'FAILED' || status.failed) {
              const errCode = status.errorCode || 'MAPPING_FAILED';
              const errMsg = status.errorMessage || (status as any).message || 'Resource–User Mapping failed on remote portal.';
              throw Object.assign(new Error(errMsg), { code: errCode, runId: mapRes.runId });
            }
          }
          if (!mapSuccess) {
            throw Object.assign(new Error(`Resource–User Mapping timed out on agent (Run ID: ${mapRes.runId}).`), {
              code: 'MAPPING_TIMEOUT',
              runId: mapRes.runId,
            });
          }
        } else if (mapRes.success === false) {
          throw Object.assign(new Error(mapRes.message || 'Failed to map resource to user on client portal.'), {
            code: 'MAPPING_FAILED',
          });
        }

        setVerifiedRemoteMapping(true);
        const isReused = Boolean(mapRes.alreadyExists);
        setSequentialSteps((prev) =>
          prev.map((s) =>
            s.stage === 'RESOURCE_USER_MAPPING'
              ? {
                  ...s,
                  status: isReused ? 'SKIPPED_ALREADY_VERIFIED' : 'VERIFIED',
                  detail: `Verified on /addParentResourceUser (${currentResourceId} ↔ ${currentUsername})`,
                }
              : s
          )
        );
      } catch (err: any) {
        const errCode = err.code || err.response?.code || 'MAPPING_FAILED';
        const msg = err.response?.message || err.message || 'Resource–User Mapping failed';
        const runId = err.runId || undefined;
        const isTimeout = errCode === 'MAPPING_TIMEOUT';

        setErrorMessage(`Step 4 Resource–User Mapping Failed: ${msg}`);
        setSequentialFailure({
          failedStage: 'RESOURCE_USER_MAPPING',
          errorCode: errCode,
          errorMessage: msg,
          runId,
          verifiedStages: [
            { stage: 'RESOURCE', label: 'Resource', idOrValue: currentResourceId! },
            { stage: 'USER', label: 'User', idOrValue: currentUsername! },
            { stage: 'ROLE_ASSIGNMENT', label: 'Roles', idOrValue: selectedRoles.join(', ') },
          ],
          summary: `Resource: VERIFIED (${currentResourceId}) | User: VERIFIED (${currentUsername}) | Role: VERIFIED ([${selectedRoles.join(', ')}]) | Mapping: ${isTimeout ? 'UNRESOLVED' : 'FAILED'} (${msg})`,
        });
        setSequentialSteps((prev) =>
          prev.map((s) =>
            s.stage === 'RESOURCE_USER_MAPPING'
              ? { ...s, status: isTimeout ? 'UNRESOLVED' : 'FAILED', errorCode: errCode, runId, detail: msg }
              : s
          )
        );
        setIsSubmittingSequential(false);
        setSequentialActiveMessage(null);
        return;
      }
    } else {
      setSequentialSteps((prev) =>
        prev.map((s) => (s.stage === 'RESOURCE_USER_MAPPING' ? { ...s, status: 'SKIPPED_ALREADY_VERIFIED', detail: `Safely reused verified mapping (${currentResourceId} ↔ ${currentUsername})` } : s))
      );
    }

    // -------------------------------------------------------------
    // STAGE 5: All 4 Remotely Verified -> Show Success Popup
    // -------------------------------------------------------------
    setIsSubmittingSequential(false);
    setSequentialActiveMessage(null);
    setSequentialFailure(null);
    setSuccessPopupData({
      resourceName: wResourceName.trim(),
      remoteResourceId: currentResourceId!,
      username: currentUsername!,
      assignedRoles: selectedRoles,
      mappingStatus: 'Verified',
      mappingRoute: '/addParentResourceUser',
    });
    setIsSuccessPopupOpen(true);
  };

  // Step 3 Dedicated Execution: Process & Verify eClaim User Configuration on /addUserEclaim
  const handleProcessEclaimStep3 = async () => {
    if (isSubmittingEclaimOnly) return;

    if (!selectedClientId) {
      setErrorMessage('Please select a client first.');
      return;
    }

    if (!wEclaimEnabled) {
      setWEclaimEnabled(true);
    }

    const activeTargetUsername =
      verifiedRemoteUserId ||
      (wCreateUser ? wUsername.trim() : (wMappingUsername.trim() || wUsername.trim()));

    if (!activeTargetUsername) {
      setErrorMessage('A valid username (from Step 2) is required before linking eClaim.');
      setActiveStep(2);
      return;
    }

    const eclaimNameTarget = wEclaimName.trim() || activeTargetUsername;
    const rawLink = wEclaimLink.trim() || eclaimNameTarget;
    const effectiveEclaimLink = rawLink.replace(/^https?:\/\//i, '').replace(/[:?#].*$/, '').replace(/[^A-Za-z0-9_/@.-]/g, '') || eclaimNameTarget;

    if (!wEclaimPassword) {
      setErrorMessage('Step 3: Eclaim Password is required.');
      return;
    }

    setIsSubmittingEclaimOnly(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const eclaimPayloadConfig = {
      enabled: true,
      eclaimLink: effectiveEclaimLink,
      eclaimName: eclaimNameTarget,
      eclaimPassword: wEclaimPassword,
      licenseNumber: wEclaimLicense.trim() || undefined,
      insuranceCompany: wEclaimInsuranceCompany.trim() || undefined,
      actualLicenseNo: wEclaimActualLicenseNo.trim() || undefined,
      oldEclaimName: wEclaimOldName.trim() || undefined,
      oldEclaimPassword: wEclaimOldPassword || undefined,
      oldLicenseNo: wEclaimOldLicenseNo.trim() || undefined,
      providerId: wEclaimProviderId.trim() || undefined,
      facilityId: wEclaimFacilityId.trim() || undefined,
      specialtyCode: wEclaimSpecialtyCode.trim() || undefined,
    };

    try {
      let runId: string | undefined;

      // If Resource and User are already verified, resume directly at RESOURCE_USER_MAPPED_ECLAIM_PENDING
      if (verifiedRemoteResourceId && (verifiedRemoteUserId || wMappingUsername.trim())) {
        const res = await clientResourcesApi.resumeIntegratedProvisioning({
          clientId: selectedClientId,
          remoteResourceId: verifiedRemoteResourceId,
          remoteUserId: verifiedRemoteUserId || wMappingUsername.trim(),
          startStage: 'RESOURCE_USER_MAPPED_ECLAIM_PENDING',
          updatedDto: {
            resourceName: wResourceName.trim(),
            isResourceHuman: wIsHuman,
            resourceType: wResourceType,
            specialty: wSpecialty,
            username: activeTargetUsername,
            eclaimConfig: eclaimPayloadConfig,
          },
        });
        runId = res.runId;
      } else {
        // Otherwise execute integrated provisioning pipeline through eClaim
        const payload: CreateIntegratedResourceInput = {
          clientId: selectedClientId,
          resourceName: wResourceName.trim(),
          isResourceHuman: wIsHuman,
          resourceType: wResourceType,
          specialty: wSpecialty,
          departments: wDepartments || 'ALL',
          services: wServices || 'ALL',
          colorIdentificationCode: wColorCode || 'FFFFFF',
          operatingFrom: wOperatingFrom !== undefined && wOperatingFrom !== '' ? wOperatingFrom : '00:00',
          operatingTo: wOperatingTo !== undefined && wOperatingTo !== '' ? wOperatingTo : '23:55',
          branchId: wBranchId || undefined,
          branchName: wBranchName || undefined,

          createAssociatedUser: wIsHuman && wCreateUser,
          username: activeTargetUsername,
          firstName: wIsHuman && wCreateUser ? wFirstName.trim() : undefined,
          middleName: wIsHuman && wCreateUser ? wMiddleName.trim() : undefined,
          lastName: wIsHuman && wCreateUser ? wLastName.trim() : undefined,
          nickName: wIsHuman && wCreateUser ? wNickName.trim() : undefined,
          email: wIsHuman && wCreateUser ? wEmail.trim() : undefined,
          mobileNumber: wIsHuman && wCreateUser ? wMobile.trim() : undefined,
          nationality: wIsHuman && wCreateUser ? wNationality.trim() : undefined,
          roles: selectedRoles.length > 0 ? selectedRoles.join(', ') : undefined,
          profileRole: wProfileRole || undefined,
          barcodeNumber: wBarcode || undefined,

          eclaimConfig: eclaimPayloadConfig,
        };

        const res = await clientResourcesApi.createIntegratedResource(payload);
        runId = (res as any).runId;
      }

      if (runId) {
        let attempts = 0;
        const maxAttempts = 60;
        let isDone = false;

        while (attempts < maxAttempts) {
          await new Promise((r) => setTimeout(r, 1500));
          attempts++;
          const lastStatus: any = await clientResourcesApi.getProvisioningRunStatus(runId);

          if (lastStatus.status === 'COMPLETED' || lastStatus.status === 'SUCCEEDED' || lastStatus.completed) {
            isDone = true;
            break;
          }

          const eclaimOutcome = lastStatus.stepOutcomes?.find((s: any) => s.operation === 'ECLAIM_CONFIGURATION');
          if (eclaimOutcome && (eclaimOutcome.status === 'VERIFIED' || eclaimOutcome.status === 'COMPLETED')) {
            isDone = true;
            break;
          }

          if (lastStatus.status === 'FAILED' || lastStatus.failed) {
            const errCode = lastStatus.errorCode || 'ECLAIM_CONFIG_FAILED';
            const errMsg = lastStatus.errorMessage || lastStatus.message || 'eClaim configuration failed on remote portal.';
            throw Object.assign(new Error(errMsg), { code: errCode, runId });
          }
        }

        if (!isDone) {
          throw Object.assign(new Error(`eClaim configuration timed out on agent (Run ID: ${runId}).`), {
            code: 'ECLAIM_TIMEOUT',
            runId,
          });
        }
      }

      setVerifiedEclaimStatus('CONFIGURED');
      setSuccessMessage(`eClaim link for user '${eclaimNameTarget}' configured and verified on remote portal.`);

      setSuccessPopupData({
        resourceName: wResourceName.trim() || 'Resource Master',
        remoteResourceId: verifiedRemoteResourceId || 'Verified',
        username: activeTargetUsername,
        assignedRoles: selectedRoles.length > 0 ? selectedRoles : ['User'],
        mappingStatus: 'Verified',
        mappingRoute: '/addParentResourceUser',
        eclaimStatus: 'Configured & Verified',
        eclaimLink: wEclaimLink.trim(),
        eclaimName: eclaimNameTarget,
      });
      setIsSuccessPopupOpen(true);
    } catch (err: any) {
      const errMsg = err.response?.message || err.message || 'eClaim configuration failed';
      setErrorMessage(`Step 3 eClaim Processing Failed: ${errMsg}`);
    } finally {
      setIsSubmittingEclaimOnly(false);
    }
  };

  // Submit Integrated Resource Provisioning
  const handleSubmitIntegrated = async () => {
    if (!selectedClientId || isSubmittingIntegrated) return;

    if (!wResourceName.trim()) {
      setErrorMessage('Resource Name is required in Section 1.');
      setActiveStep(1);
      return;
    }

    if (wIsHuman && wCreateUser) {
      if (!wUsername.trim() || !wFirstName.trim() || !wLastName.trim()) {
        setErrorMessage('Username, First Name, and Last Name are required when creating an associated user.');
        setActiveStep(2);
        return;
      }
    }

    setIsSubmittingIntegrated(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setSubmissionProgressStage('RESOURCE_PARENT_CREATION');

    const payload: CreateIntegratedResourceInput = {
      clientId: selectedClientId,
      resourceName: wResourceName.trim(),
      isResourceHuman: wIsHuman,
      resourceType: wResourceType,
      specialty: wSpecialty,
      departments: wDepartments || 'ALL',
      services: wServices || 'ALL',
      colorIdentificationCode: wColorCode || 'FFFFFF',
      operatingFrom: wOperatingFrom !== undefined && wOperatingFrom !== '' ? wOperatingFrom : '00:00',
      operatingTo: wOperatingTo !== undefined && wOperatingTo !== '' ? wOperatingTo : '23:55',
      branchId: wBranchId || undefined,
      branchName: wBranchName || undefined,

      createAssociatedUser: wIsHuman && wCreateUser,
      username: wIsHuman && wCreateUser ? wUsername.trim() : (wMappingUsername.trim() || undefined),
      firstName: wIsHuman && wCreateUser ? wFirstName.trim() : undefined,
      middleName: wIsHuman && wCreateUser ? wMiddleName.trim() : undefined,
      lastName: wIsHuman && wCreateUser ? wLastName.trim() : undefined,
      nickName: wIsHuman && wCreateUser ? wNickName.trim() : undefined,
      email: wIsHuman && wCreateUser ? wEmail.trim() : undefined,
      mobileNumber: wIsHuman && wCreateUser ? wMobile.trim() : undefined,
      nationality: wIsHuman && wCreateUser ? wNationality.trim() : undefined,
      roles: wIsHuman && (wCreateUser || wMappingUsername.trim()) && selectedRoles.length > 0 ? selectedRoles.join(', ') : undefined,
      profileRole: wIsHuman && wCreateUser ? wProfileRole : undefined,
      barcodeNumber: wIsHuman && wCreateUser ? wBarcode : undefined,
      reportsNumberInDays: wIsHuman && wCreateUser ? wReportsDays : undefined,
      signatureWidth: wIsHuman && wCreateUser ? wSigWidth : undefined,
      signatureHeight: wIsHuman && wCreateUser ? wSigHeight : undefined,

      isShownInRegistration: wIsShownInRegistration,

      eclaimConfig:
        wEclaimEnabled
          ? {
              enabled: true,
              eclaimLink: (wEclaimLink.trim() || wEclaimName.trim() || (wCreateUser ? wUsername.trim() : (wMappingUsername.trim() || ''))).replace(/^https?:\/\//i, '').replace(/[:?#].*$/, '').replace(/[^A-Za-z0-9_/@.-]/g, '') || undefined,
              eclaimName: wEclaimName.trim() || (wCreateUser ? wUsername.trim() : (wMappingUsername.trim() || undefined)),
              eclaimPassword: wEclaimPassword || undefined,
              licenseNumber: wEclaimLicense.trim() || undefined,
              insuranceCompany: wEclaimInsuranceCompany.trim() || undefined,
              actualLicenseNo: wEclaimActualLicenseNo.trim() || undefined,
              oldEclaimName: wEclaimOldName.trim() || undefined,
              oldEclaimPassword: wEclaimOldPassword || undefined,
              oldLicenseNo: wEclaimOldLicenseNo.trim() || undefined,
              providerId: wEclaimProviderId.trim() || undefined,
              facilityId: wEclaimFacilityId.trim() || undefined,
              specialtyCode: wEclaimSpecialtyCode.trim() || undefined,
            }
          : undefined,

      emrForms:
        wSelectedFormIds.length > 0
          ? {
              formIds: wSelectedFormIds,
              defaultFormId: wDefaultFormId || wSelectedFormIds[0],
              encounterType: wFormEncounterType,
              group: wFormGroup,
            }
          : undefined,

      transferConfig:
        wTransferEnabled && wTransferBranchId
          ? {
              enabled: true,
              targetBranchId: wTransferBranchId,
              targetBranchName: wTransferBranchName || undefined,
              defaultFormIndicator: wTransferIndicatorS ? 'S' : 'No',
              formIds: wTransferFormIds.length > 0 ? wTransferFormIds : wSelectedFormIds,
              encounterType: wFormEncounterType,
              group: wFormGroup,
            }
          : undefined,
    };

    // Initialize the 6-step live outcome tracker
    setProvisioningOutcomes([
      {
        operation: 'RESOURCE_CREATION',
        name: 'Resource Parent Creation',
        route: '/addResourceParentDetails',
        status: verifiedRemoteResourceId ? 'VERIFIED' : 'PENDING',
        remoteId: verifiedRemoteResourceId || undefined,
        details: verifiedRemoteResourceId ? `Existing verified resource: ${verifiedRemoteResourceId}` : undefined,
      },
      {
        operation: 'USER_PROVISIONING',
        name: wCreateUser ? 'User Provisioning (/addUsers)' : 'Existing User Verification (/users)',
        route: wCreateUser ? '/addUsers' : '/users',
        status: !wIsHuman ? 'SKIPPED' : verifiedRemoteUserId ? 'VERIFIED' : 'PENDING',
        remoteId: verifiedRemoteUserId || undefined,
        details: !wIsHuman ? 'Not applicable for non-human resource' : verifiedRemoteUserId ? `Existing verified user: ${verifiedRemoteUserId}` : undefined,
      },
      {
        operation: 'ROLE_ASSIGNMENT',
        name: 'Role Assignment (/addUserRole)',
        route: '/addUserRole',
        status: !wIsHuman ? 'SKIPPED' : (!wRoles.trim() ? 'SKIPPED' : 'PENDING'),
        details: !wIsHuman ? 'Not applicable for non-human resource' : (!wRoles.trim() ? 'No roles requested' : undefined),
      },
      {
        operation: 'RESOURCE_USER_MAPPING',
        name: 'User-Resource Mapping (/addParentResourceUser)',
        route: '/addParentResourceUser',
        status: !wIsHuman ? 'SKIPPED' : 'PENDING',
        details: !wIsHuman ? 'Not applicable for non-human resource' : undefined,
      },
      {
        operation: 'ECLAIM_CONFIGURATION',
        name: 'eClaim User Configuration',
        route: '/addUserEclaim',
        status: wEclaimEnabled ? 'PENDING' : 'SKIPPED',
        details: !wEclaimEnabled ? 'No eClaim configuration requested' : undefined,
      },
      {
        operation: 'EMR_FORM_ASSIGNMENT',
        name: 'EMR Form Assignment & Branch Transfer (/emrPanelSelection)',
        route: '/emrPanelSelection',
        status: wSelectedFormIds.length > 0 ? 'PENDING' : 'SKIPPED',
        details: wSelectedFormIds.length === 0 ? 'No forms selected for assignment' : undefined,
      },
    ]);

    let backgroundPollingStarted = false;
    try {
      const res = await clientResourcesApi.createIntegratedResource(payload);

      // If execution timed out on the 25-second wait budget or is still progressing remotely:
      if ((res as any).status === 'IN_PROGRESS' || (res as any).isPending || !res.success) {
        const runId = (res as any).runId;
        if (runId) {
          backgroundPollingStarted = true;
          localStorage.setItem('hmc_active_provisioning_run', JSON.stringify({
            runId,
            clientId: selectedClientId,
            stage: res.stage || 'RESOURCE_WORKFLOW_IN_PROGRESS',
            timestamp: Date.now(),
          }));
          setActivePollingRunId(runId);
          setIsSubmittingIntegrated(true);
          setSubmissionProgressStage(res.stage || 'RESOURCE_WORKFLOW_IN_PROGRESS');
          if (res.stepOutcomes && res.stepOutcomes.length > 0) {
            setProvisioningOutcomes(res.stepOutcomes);
          }
          return;
        }
      }

      if (res.stepOutcomes && res.stepOutcomes.length > 0) {
        setProvisioningOutcomes(res.stepOutcomes);
      }
      const createdId = res.resource?.remoteResourceId || 'Created';
      setVerifiedRemoteResourceId(createdId);
      if (res.resource?.linkedUsername) {
        setVerifiedRemoteUserId(res.resource.linkedUsername);
      }
      setSuccessMessage(`Integrated resource created and verified remotely! Resource Code: ${createdId}`);
      setIsCreateModalOpen(false);
      try { localStorage.removeItem('hmc_active_provisioning_run'); } catch {}

      setWorkflowSuccessDetails({
        resourceName: wResourceName.trim() || res.resource?.resourceName || 'Verified Resource',
        resourceCode: createdId,
        username: (res as any).remoteUserId || res.resource?.linkedUsername || wUsername.trim() || 'Verified User',
        roles: wRoles.trim() || 'Assigned Roles',
        mappedResource: `${createdId} ↔ ${(res as any).remoteUserId || res.resource?.linkedUsername || wUsername.trim()}`,
        eclaimStatus: (res as any).eclaimStatus || (wEclaimEnabled ? 'Configured & Verified' : 'N/A'),
        selectedEmrForms: wSelectedFormIds.length > 0 ? wSelectedFormIds : ((res as any).assignedForms || []),
        targetBranch: wTransferBranchName || wTransferBranchId || 'Default Branch',
        defaultFormValue: wTransferIndicatorS ? 'Yes (Default)' : 'No',
      });
      setWorkflowSuccessModalOpen(true);

      // Check if ephemeral credentials were generated
      if (res.createdUserCredentials && res.createdUserCredentials.password) {
        setCreatedCredential({
          username: res.createdUserCredentials.username,
          password: res.createdUserCredentials.password,
          roles: res.createdUserCredentials.roles,
        });
        setEphemeralCredModalOpen(true);
      }

      resetIntegratedForm();
      fetchResources();
    } catch (err: any) {
      setIsSubmittingIntegrated(false);
      setSubmissionProgressStage(null);
      try { localStorage.removeItem('hmc_active_provisioning_run'); } catch {}
      const errMsg = err.message || 'Integrated resource provisioning failed.';
      setErrorMessage(errMsg);
      const outcomes = err.stepOutcomes || err.response?.data?.stepOutcomes;
      if (outcomes && outcomes.length > 0) {
        setProvisioningOutcomes(outcomes);
      }
      if (err.remoteResourceId) {
        setVerifiedRemoteResourceId(err.remoteResourceId);
      }
      if (err.remoteUserId) {
        setVerifiedRemoteUserId(err.remoteUserId);
      }
      if (err.workflowStage) {
        setResumeStage(err.workflowStage);
      } else if (errMsg.includes('EMR')) {
        setResumeStage('ECLAIM_COMPLETED_EMR_FORMS_PENDING');
        setActiveStep(4);
      } else if (errMsg.includes('eClaim')) {
        setResumeStage('RESOURCE_USER_MAPPED_ECLAIM_PENDING');
        setActiveStep(3);
      } else if (errMsg.includes('Mapping') || errMsg.includes('User')) {
        setResumeStage('RESOURCE_CREATED_USER_PENDING');
        setActiveStep(2);
      }
    } finally {
      if (!backgroundPollingStarted && !activePollingRunId) {
        setIsSubmittingIntegrated(false);
        setSubmissionProgressStage(null);
      }
    }
  };

  // Resume failed provisioning from verified checkpoint
  const handleResumeProvisioning = async () => {
    if (!selectedClientId || isSubmittingIntegrated) return;
    setIsSubmittingIntegrated(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setSubmissionProgressStage('RESUMING_FROM_CHECKPOINT');

    let backgroundPollingStarted = false;
    try {
      const res = await clientResourcesApi.resumeIntegratedProvisioning({
        clientId: selectedClientId,
        remoteResourceId: verifiedRemoteResourceId || undefined,
        remoteUserId: verifiedRemoteUserId || undefined,
        startStage: resumeStage || undefined,
        updatedDto: {
          resourceName: wResourceName.trim(),
          isResourceHuman: wIsHuman,
          resourceType: wResourceType,
          specialty: wSpecialty,
          username: wUsername.trim() || undefined,
          eclaimConfig: wEclaimEnabled ? {
            enabled: true,
            eclaimLink: (wEclaimLink.trim() || wEclaimName.trim() || (wCreateUser ? wUsername.trim() : (wMappingUsername.trim() || ''))).replace(/^https?:\/\//i, '').replace(/[:?#].*$/, '').replace(/[^A-Za-z0-9_/@.-]/g, '') || undefined,
            eclaimName: wEclaimName.trim() || (wCreateUser ? wUsername.trim() : (wMappingUsername.trim() || undefined)),
            eclaimPassword: wEclaimPassword || undefined,
            licenseNumber: wEclaimLicense.trim() || undefined,
            insuranceCompany: wEclaimInsuranceCompany.trim() || undefined,
            actualLicenseNo: wEclaimActualLicenseNo.trim() || undefined,
            oldEclaimName: wEclaimOldName.trim() || undefined,
            oldEclaimPassword: wEclaimOldPassword || undefined,
            oldLicenseNo: wEclaimOldLicenseNo.trim() || undefined,
            providerId: wEclaimProviderId.trim() || undefined,
            facilityId: wEclaimFacilityId.trim() || undefined,
            specialtyCode: wEclaimSpecialtyCode.trim() || undefined,
          } : undefined,
          emrForms: wSelectedFormIds.length > 0 ? {
            formIds: wSelectedFormIds,
            defaultFormId: wDefaultFormId || wSelectedFormIds[0],
            encounterType: wFormEncounterType,
            group: wFormGroup,
          } : undefined,
        },
      });

      if ((res as any).status === 'IN_PROGRESS' || (res as any).isPending || !res.success) {
        const runId = (res as any).runId;
        if (runId) {
          backgroundPollingStarted = true;
          localStorage.setItem('hmc_active_provisioning_run', JSON.stringify({
            runId,
            clientId: selectedClientId,
            stage: res.stage || 'RESOURCE_WORKFLOW_IN_PROGRESS',
            timestamp: Date.now(),
          }));
          setActivePollingRunId(runId);
          setIsSubmittingIntegrated(true);
          setSubmissionProgressStage(res.stage || 'RESOURCE_WORKFLOW_IN_PROGRESS');
          return;
        }
      }

      if (res.stepOutcomes) {
        setProvisioningOutcomes(res.stepOutcomes);
      }
      const createdId = res.resource?.remoteResourceId || verifiedRemoteResourceId || 'Verified';
      setSuccessMessage(`Resource provisioning resumed and completed successfully! Resource Code: ${createdId}`);
      setResumeStage(null);
      setIsCreateModalOpen(false);
      try { localStorage.removeItem('hmc_active_provisioning_run'); } catch {}

      setWorkflowSuccessDetails({
        resourceName: wResourceName.trim() || res.resource?.resourceName || 'Verified Resource',
        resourceCode: createdId,
        username: (res as any).remoteUserId || res.resource?.linkedUsername || verifiedRemoteUserId || wUsername.trim() || 'Verified User',
        roles: wRoles.trim() || 'Assigned Roles',
        mappedResource: `${createdId} ↔ ${(res as any).remoteUserId || verifiedRemoteUserId || wUsername.trim()}`,
        eclaimStatus: (res as any).eclaimStatus || (wEclaimEnabled ? 'Configured & Verified' : 'N/A'),
        selectedEmrForms: wSelectedFormIds.length > 0 ? wSelectedFormIds : ((res as any).assignedForms || []),
        targetBranch: wTransferBranchName || wTransferBranchId || 'Default Branch',
        defaultFormValue: wTransferIndicatorS ? 'Yes (Default)' : 'No',
      });
      setWorkflowSuccessModalOpen(true);

      resetIntegratedForm();
      fetchResources();
    } catch (err: any) {
      setIsSubmittingIntegrated(false);
      setSubmissionProgressStage(null);
      try { localStorage.removeItem('hmc_active_provisioning_run'); } catch {}
      const errMsg = err.message || 'Resumed provisioning failed.';
      setErrorMessage(errMsg);
      const outcomes = err.stepOutcomes || err.response?.data?.stepOutcomes;
      if (outcomes && outcomes.length > 0) {
        setProvisioningOutcomes(outcomes);
      }
    } finally {
      if (!backgroundPollingStarted && !activePollingRunId) {
        setIsSubmittingIntegrated(false);
        setSubmissionProgressStage(null);
      }
    }
  };

  // Toggle status
  const handleToggleStatus = async (resource: ResourceItem) => {
    if (!selectedClientId || togglingResourceId !== null) return;
    setTogglingResourceId(resource.remoteResourceId);
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
    } finally {
      setTogglingResourceId(null);
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

  // Preview Uploaded Workbook
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

  // Export Job Results
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

  // Download Template (1-Sheet Step-Wise, 6-Sheet, or 10-Sheet)
  const handleDownloadTemplate = async (format: '1-SHEET' | '6-SHEET' | '10-SHEET' = '1-SHEET') => {
    const selectedClient = clients.find((c) => c.id === selectedClientId);
    try {
      const { blob, filename } = await clientResourcesApi.downloadTemplate(selectedClientId, selectedClient?.clientCode, format);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `HMC_Resource_Master_${format}_Template.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to download template.');
    }
  };


  // Export Resources
  const handleExport = async (mode: 'ALL' | 'ACTIVE_ONLY' | 'INACTIVE_ONLY') => {
    if (!selectedClientId) return;
    setIsExportMenuOpen(false);
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

  // Filtered EMR Forms
  const filteredEmrForms = emrFormsList.filter((f) => {
    if (!wFormSearch.trim()) return true;
    const term = wFormSearch.toLowerCase();
    return (
      f.formName.toLowerCase().includes(term) ||
      f.formId.toLowerCase().includes(term) ||
      (f.group && f.group.toLowerCase().includes(term)) ||
      (f.encounterType && f.encounterType.toLowerCase().includes(term))
    );
  });

  const formTotalPages = Math.ceil(filteredEmrForms.length / formPageSize) || 1;
  const paginatedForms = filteredEmrForms.slice((wFormPage - 1) * formPageSize, wFormPage * formPageSize);

  // Isolate EMR form selection per user - switching users loads that user's specific selections
  useEffect(() => {
    if (!activeEmrUsername) return;
    const existing = userFormAssignments[activeEmrUsername];
    if (existing) {
      setWSelectedFormIds(existing.formIds);
      setWDefaultFormId(existing.defaultFormId || '');
    } else {
      setWSelectedFormIds([]);
      setWDefaultFormId('');
    }
  }, [activeEmrUsername]);

  // Toggle form assignment for the active user
  const toggleFormAssign = (formId: string) => {
    setUserFormAssignments((prev) => {
      const current = prev[activeEmrUsername] || { formIds: wSelectedFormIds, defaultFormId: wDefaultFormId };
      const exists = current.formIds.includes(formId);
      let nextFormIds: string[];
      let nextDefault = current.defaultFormId;

      if (exists) {
        nextFormIds = current.formIds.filter((id) => id !== formId);
        // Constraint: unassigning default clears default
        if (nextDefault === formId) {
          nextDefault = '';
        }
      } else {
        nextFormIds = [...current.formIds, formId];
      }

      setWSelectedFormIds(nextFormIds);
      setWDefaultFormId(nextDefault || '');

      return {
        ...prev,
        [activeEmrUsername]: {
          formIds: nextFormIds,
          defaultFormId: nextDefault,
        },
      };
    });
  };

  // Toggle/Set form default for the active user
  const toggleFormDefault = (formId: string) => {
    setUserFormAssignments((prev) => {
      const current = prev[activeEmrUsername] || { formIds: wSelectedFormIds, defaultFormId: wDefaultFormId };
      // Constraint: Selecting Default must assign the form automatically if not already assigned
      const nextFormIds = current.formIds.includes(formId) ? current.formIds : [...current.formIds, formId];
      // Max 1 default: set this form as default
      const nextDefault = formId;

      setWSelectedFormIds(nextFormIds);
      setWDefaultFormId(nextDefault);

      return {
        ...prev,
        [activeEmrUsername]: {
          formIds: nextFormIds,
          defaultFormId: nextDefault,
        },
      };
    });
  };

  const selectAllFilteredForms = () => {
    const allIds = filteredEmrForms.map((f) => f.formId);
    setUserFormAssignments((prev) => {
      const current = prev[activeEmrUsername] || { formIds: wSelectedFormIds, defaultFormId: wDefaultFormId };
      const nextFormIds = Array.from(new Set([...current.formIds, ...allIds]));
      const nextDefault = current.defaultFormId || (allIds.length > 0 ? allIds[0] : '');

      setWSelectedFormIds(nextFormIds);
      setWDefaultFormId(nextDefault);

      return {
        ...prev,
        [activeEmrUsername]: {
          formIds: nextFormIds,
          defaultFormId: nextDefault,
        },
      };
    });
  };

  const deselectAllForms = () => {
    setUserFormAssignments((prev) => {
      setWSelectedFormIds([]);
      setWDefaultFormId('');

      return {
        ...prev,
        [activeEmrUsername]: {
          formIds: [],
          defaultFormId: '',
        },
      };
    });
  };

  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const totalPages = Math.ceil(totalCount / limit) || 1;

  // Compute stat counters
  const totalDisplay = resourceSummary ? resourceSummary.total : totalCount;
  const humanDisplay = resourceSummary ? resourceSummary.humanCount : resources.filter((r) => r.isResourceHuman && r.remoteStatus === 'ACTIVE').length;
  const nonHumanDisplay = resourceSummary ? resourceSummary.nonHumanCount : resources.filter((r) => !r.isResourceHuman && r.remoteStatus === 'ACTIVE').length;
  const linkedDisplay = resourceSummary ? resourceSummary.linkedCount : resources.filter((r) => r.linkedUsername && r.remoteStatus === 'ACTIVE').length;

  return (
    <div className="space-y-6">
      {/* Top Header & Client Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-surface p-6 rounded-xl border border-surface-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-sky-600/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100">Central Resource Master</h1>
            <p className="text-xs text-slate-400">
              Integrated Resource + User + Mapping + eClaim + EMR Form Master workflow
            </p>
          </div>
        </div>

        {/* Client Selection Dropdown & Sync */}
        <div className="flex items-center gap-3">
          <div className="text-xs text-slate-400 font-medium">Selected Client:</div>
          <select
            value={selectedClientId}
            onChange={(e) => {
              setSelectedClientId(e.target.value);
              localStorage.setItem('hmc_selected_client_id', e.target.value);
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
          <span className="flex-1">{errorMessage}</span>
          {resumeStage && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="text-xs bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 px-3 py-1 rounded font-semibold transition-colors"
            >
              Resume Workflow
            </button>
          )}
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
            <div className="text-2xl font-bold text-slate-100">{totalDisplay}</div>
          </div>
        </div>

        <div className="bg-surface border border-surface-border p-4 rounded-xl flex items-center gap-4">
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-lg">
            <Stethoscope className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">Human Practitioners</div>
            <div className="text-2xl font-bold text-slate-100">{humanDisplay}</div>
          </div>
        </div>

        <div className="bg-surface border border-surface-border p-4 rounded-xl flex items-center gap-4">
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-lg">
            <User className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">Linked Console Users</div>
            <div className="text-2xl font-bold text-slate-100">{linkedDisplay}</div>
          </div>
        </div>

        <div className="bg-surface border border-surface-border p-4 rounded-xl flex items-center gap-4">
          <div className="p-3 bg-amber-500/10 text-amber-400 rounded-lg">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">Rooms / Equipment</div>
            <div className="text-2xl font-bold text-slate-100">{nonHumanDisplay}</div>
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
              setTypeFilter('');
              setPage(1);
            }}
            className="bg-slate-900 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500"
          >
            <option value="ALL">All Human/Non-Human</option>
            <option value="true">Human (Doctors/Staff)</option>
            <option value="false">Non-Human (Rooms/Equip)</option>
          </select>

          {/* Resource Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
            className="bg-slate-900 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500"
          >
            <option value="">All Resource Types</option>
            {(isHumanFilter === 'true'
              ? humanResourceTypes
              : isHumanFilter === 'false'
              ? nonHumanResourceTypes
              : resourceTypes
            ).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
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
        <div className="flex items-center gap-2 w-full md:w-auto justify-end relative">
          {hasPermission(PERMISSIONS.CLIENT_RESOURCES_CREATE) && (
            <button
              onClick={() => {
                resetIntegratedForm();
                setIsCreateModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold transition-all shadow-md shadow-emerald-900/30"
            >
              <Plus className="w-4 h-4" />
              <span>Add Resource (6-in-1)</span>
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
            <div className="relative">
              <button
                onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-sm font-medium transition-all"
                title="Export Options"
              >
                <Download className="w-4 h-4 text-sky-400" />
                <span>Export</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {isExportMenuOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-20 py-1 text-xs">
                  <button
                    onClick={() => handleExport('ALL')}
                    className="w-full text-left px-4 py-2 text-slate-200 hover:bg-slate-800 flex items-center justify-between"
                  >
                    <span>All Resources</span>
                    <span className="text-[10px] text-slate-500 font-mono">ALL</span>
                  </button>
                  <button
                    onClick={() => handleExport('ACTIVE_ONLY')}
                    className="w-full text-left px-4 py-2 text-emerald-400 hover:bg-slate-800 flex items-center justify-between"
                  >
                    <span>Active Only</span>
                    <span className="text-[10px] text-emerald-500 font-mono">ACTIVE</span>
                  </button>
                  <button
                    onClick={() => handleExport('INACTIVE_ONLY')}
                    className="w-full text-left px-4 py-2 text-rose-400 hover:bg-slate-800 flex items-center justify-between"
                  >
                    <span>Inactive Only</span>
                    <span className="text-[10px] text-rose-500 font-mono">INACTIVE</span>
                  </button>
                </div>
              )}
            </div>
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
                    No resources found. Click "Add Resource (6-in-1)" or "Import Excel" to create records.
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
                        {item.isResourceHuman ? 'Yes (Human)' : 'Non-Human'}
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
                            disabled={togglingResourceId !== null}
                            className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                              togglingResourceId !== null ? 'opacity-50 cursor-not-allowed ' : ''
                            }${
                              item.remoteStatus === 'ACTIVE'
                                ? 'bg-slate-800 hover:bg-rose-900/30 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-800/40'
                                : 'bg-slate-800 hover:bg-emerald-900/30 text-slate-400 hover:text-emerald-400 border border-slate-700 hover:border-emerald-800/40'
                            }`}
                          >
                            {togglingResourceId === item.remoteResourceId ? 'Updating...' : item.remoteStatus === 'ACTIVE' ? 'Deactivate' : 'Activate'}
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

      {/* 6-IN-1 INTEGRATED RESOURCE ENTRY WIZARD MODAL */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          if (isSubmittingIntegrated && !activePollingRunId) {
            setIsSubmittingIntegrated(false);
          }
        }}
        title="Central Resource Master — Integrated Entry Wizard"
        maxWidth="max-w-4xl"
      >
        <div className="space-y-5">
          {/* Stepper Header */}
          <div className="grid grid-cols-4 gap-2 bg-slate-900/80 p-2 rounded-xl border border-slate-800">
            {[
              { num: 1, label: 'Resource' },
              { num: 2, label: 'User' },
              { num: 3, label: 'eClaim' },
              { num: 4, label: 'EMR Forms' },
            ].map((s) => (
              <button
                key={s.num}
                type="button"
                onClick={() => setActiveStep(s.num)}
                className={`py-2 px-1 text-center rounded-lg text-xs font-semibold transition-all ${
                  activeStep === s.num
                    ? 'bg-sky-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <span className="block text-[10px] uppercase opacity-75">Step {s.num}</span>
                <span className="truncate">{s.label}</span>
              </button>
            ))}
          </div>

          {/* Active Operation Status & Emergency Unlock Banner */}
          {(isSubmittingIntegrated || isSubmittingSequential || isSubmittingEclaimOnly || isSubmittingResourceOnly) && (
            <div className="flex items-center justify-between p-2.5 bg-amber-950/40 border border-amber-800/60 rounded-xl text-amber-300 text-xs">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                <span>
                  Operation in progress: <strong>{submissionProgressStage || 'EXECUTING_WORKFLOW'}</strong>
                </span>
              </div>
              <button
                type="button"
                onClick={handleForceUnlock}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded text-[11px] transition-colors shadow-sm cursor-pointer"
                title="Force reset stuck state and re-enable all controls"
              >
                Reset / Unlock Controls
              </button>
            </div>
          )}

          {/* Modal Error Alert Banner */}
          {errorMessage && (
            <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs shadow-sm">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span className="flex-1 font-medium">{errorMessage}</span>
            </div>
          )}

          {/* STEP 1 ISOLATED RESOURCE PROVISIONING MONITOR */}
          {(isSubmittingResourceOnly || resourceOnlyRunId) && (
            <div className="p-4 bg-slate-900/90 border border-emerald-800/60 rounded-xl space-y-3 shadow-inner">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                    Step 1: Isolated Resource Creation (Quick Resource)
                  </span>
                  {resourceOnlyRunId && (
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                      Run ID: {resourceOnlyRunId}
                    </span>
                  )}
                </div>
                {verifiedRemoteResourceId && (
                  <span className="text-[11px] font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 px-2 py-0.5 rounded">
                    Verified Remote Resource ID: <strong>{verifiedRemoteResourceId}</strong>
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {resourceOnlySteps.map((st, i) => (
                  <div
                    key={i}
                    className={`p-2 rounded-lg border text-xs flex items-center gap-2 ${
                      st.status === 'COMPLETED'
                        ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300'
                        : st.status === 'IN_PROGRESS'
                        ? 'bg-sky-950/40 border-sky-800/50 text-sky-300 animate-pulse'
                        : st.status === 'FAILED'
                        ? 'bg-rose-950/40 border-rose-800/50 text-rose-300'
                        : 'bg-slate-950/40 border-slate-800 text-slate-500'
                    }`}
                  >
                    {st.status === 'COMPLETED' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : st.status === 'IN_PROGRESS' ? (
                      <RefreshCw className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0" />
                    ) : st.status === 'FAILED' ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    ) : (
                      <div className="w-3.5 h-3.5 rounded-full border border-slate-700 shrink-0" />
                    )}
                    <span className="truncate text-[11px]">{st.name}</span>
                  </div>
                ))}
              </div>

              {isResourceOnlyUncertain && (
                <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-lg flex items-center justify-between text-xs text-amber-300">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 font-semibold">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Step 1 run is in-progress or uncertain (Run ID: {resourceOnlyRunId})</span>
                    </div>
                    <p className="text-[11px] text-amber-400/80">
                      Read-only reconciliation is required before allowing another submission.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleReconcileResourceOnly}
                    disabled={isReconcilingResourceOnly}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow flex items-center gap-1.5 shrink-0 transition-colors"
                  >
                    {isReconcilingResourceOnly ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5" />
                    )}
                    <span>Reconcile Status</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 5-OPERATION REMOTE ORCHESTRATION PIPELINE MONITOR */}
          {(isSubmittingIntegrated || provisioningOutcomes.length > 0 || resumeStage) && (
            <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl space-y-3 shadow-inner">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-sky-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                    5-Operation Remote Automation Pipeline
                  </span>
                </div>
                {verifiedRemoteResourceId && (
                  <span className="text-[11px] font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 px-2 py-0.5 rounded">
                    Verified Remote Resource ID: <strong>{verifiedRemoteResourceId}</strong>
                  </span>
                )}
              </div>

              {/* 6 Sequential Operation Cards */}
              <div className="space-y-2">
                {[
                  {
                    op: 'RESOURCE_CREATION',
                    stepNum: 1,
                    title: '1. Create & Verify Resource',
                    route: '/addResourceParentDetails',
                  },
                  {
                    op: 'USER_PROVISIONING',
                    stepNum: 2,
                    title: wCreateUser ? '2. Provision Linked User' : '2. Verify Existing Remote User',
                    route: wCreateUser ? '/addUsers' : '/users',
                  },
                  {
                    op: 'ROLE_ASSIGNMENT',
                    stepNum: 3,
                    title: '3. Assign & Verify Selected Roles',
                    route: '/addUserRole',
                  },
                  {
                    op: 'RESOURCE_USER_MAPPING',
                    stepNum: 4,
                    title: '4. Map User to Resource & Verify Mapping',
                    route: '/addParentResourceUser',
                  },
                  {
                    op: 'ECLAIM_CONFIGURATION',
                    stepNum: 5,
                    title: '5. Pre-flight Probe & Configure eClaim',
                    route: '/addUserEclaim',
                  },
                  {
                    op: 'EMR_FORM_ASSIGNMENT',
                    stepNum: 6,
                    title: '6. EMR Form Assignment & Branch Transfer',
                    route: '/emrPanelSelection',
                  },
                ].map((item) => {
                  const outcome = provisioningOutcomes.find((o) => o.operation === item.op);
                  const status = outcome?.status || (isSubmittingIntegrated ? 'PENDING' : 'PENDING');
                  const isSuccess = status === 'VERIFIED';
                  const isInProgress = status === 'IN_PROGRESS';
                  const isFailed = status === 'FAILED';
                  const isVerificationReq = status === 'VERIFICATION_REQUIRED';
                  const isSkipped = status === 'SKIPPED';

                  return (
                    <div
                      key={item.op}
                      className={`flex flex-col p-2.5 rounded-lg border text-xs transition-all ${
                        isSuccess
                          ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-300'
                          : isInProgress
                          ? 'bg-sky-950/30 border-sky-800/50 text-sky-200'
                          : isFailed
                          ? 'bg-rose-950/30 border-rose-800/50 text-rose-300'
                          : isVerificationReq
                          ? 'bg-amber-950/30 border-amber-800/50 text-amber-300'
                          : isSkipped
                          ? 'bg-slate-900/40 border-slate-800/40 text-slate-500'
                          : 'bg-slate-950/40 border-slate-800/30 text-slate-400'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                              isSuccess
                                ? 'bg-emerald-600 text-white'
                                : isInProgress
                                ? 'bg-sky-600 text-white animate-pulse'
                                : isFailed
                                ? 'bg-rose-600 text-white'
                                : isVerificationReq
                                ? 'bg-amber-600 text-white'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {item.stepNum}
                          </span>
                          <span className="font-semibold text-slate-200">{item.title}</span>
                          <span className="font-mono text-[10px] opacity-60">({outcome?.route || item.route})</span>
                        </div>

                        {/* Status Badge */}
                        <div className="flex items-center gap-1.5">
                          {isSuccess && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold text-[11px]">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              VERIFIED
                            </span>
                          )}
                          {isInProgress && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400 border border-sky-500/30 font-semibold text-[11px]">
                              <RefreshCw className="w-3 h-3 animate-spin text-sky-400" />
                              IN PROGRESS
                            </span>
                          )}
                          {isFailed && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 font-semibold text-[11px]">
                              <XCircle className="w-3 h-3 text-rose-400" />
                              FAILED
                            </span>
                          )}
                          {isVerificationReq && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold text-[11px]">
                              <AlertTriangle className="w-3 h-3 text-amber-400" />
                              VERIFICATION REQUIRED
                            </span>
                          )}
                          {isSkipped && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[11px]">
                              SKIPPED
                            </span>
                          )}
                          {!isSuccess && !isInProgress && !isFailed && !isVerificationReq && !isSkipped && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800/80 text-slate-500 text-[11px]">
                              PENDING
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Details & Checkpoint Info */}
                      {(outcome?.details || outcome?.errorMessage || outcome?.remoteId) && (
                        <div className="mt-1.5 pt-1.5 border-t border-white/5 text-[11px] font-mono flex items-center justify-between">
                          <span className="truncate max-w-[80%] opacity-90">
                            {outcome.errorMessage ? `Error: ${outcome.errorMessage}` : outcome.details}
                          </span>
                          {outcome.remoteId && (
                            <span className="text-[10px] bg-slate-800/80 px-1.5 py-0.5 rounded text-slate-300">
                              ID: {outcome.remoteId}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Checkpoint Resumption Action Bar */}
              {(resumeStage || provisioningOutcomes.some((o) => o.status === 'FAILED' || o.status === 'VERIFICATION_REQUIRED')) && !isSubmittingIntegrated && (
                <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-lg flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 text-amber-300 font-semibold text-xs">
                      <RotateCcw className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Checkpoint Ready: Verified operations will NOT be repeated</span>
                    </div>
                    <p className="text-[11px] text-amber-400/70">
                      {verifiedRemoteResourceId ? `Verified Resource (${verifiedRemoteResourceId}) preserved. ` : ''}
                      {verifiedRemoteUserId ? `Verified User (${verifiedRemoteUserId}) preserved. ` : ''}
                      Resuming will execute only the remaining pending operations.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleResumeProvisioning}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold shadow flex items-center gap-1.5 shrink-0 transition-colors"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Resume from Checkpoint
                  </button>
                </div>
              )}
            </div>
          )}

          {/* STEP 1: Resource Details (/addResourceParentDetails) */}
          {activeStep === 1 && (
            <div className="space-y-4">
              <div className="border-b border-slate-800 pb-2">
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-sky-600 text-white text-[11px] flex items-center justify-center font-bold">1</span>
                  Section 1: Resource Parent Details (/addResourceParentDetails)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">Define master resource attributes, type, and operating schedule</p>
              </div>

              {verifiedRemoteResourceId && (
                <div className="p-3 bg-emerald-950/40 border border-emerald-500/40 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div className="text-xs text-emerald-200">
                      Resource <strong>{wResourceName}</strong> verified on client portal (Remote ID: <strong>{verifiedRemoteResourceId}</strong>). Details preserved for Step 2.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveStep(2)}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shrink-0"
                  >
                    Proceed to Step 2 →
                  </button>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                  Resource Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dr. Faisal Al-Harbi"
                  value={wResourceName}
                  onChange={(e) => setWResourceName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                    Is Resource Human *
                  </label>
                  <select
                    value={wIsHuman ? 'Yes' : 'No'}
                    onChange={(e) => {
                      const isH = e.target.value === 'Yes';
                      setWIsHuman(isH);
                      setWCreateUser(isH);
                      const available = isH ? humanResourceTypes : nonHumanResourceTypes;
                      if (available.length > 0) {
                        setWResourceType(available[0]);
                      }
                    }}
                    className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500"
                  >
                    <option value="Yes">Yes (Human Practitioner)</option>
                    <option value="No">No (Non-Human / Room / Equipment)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                    Resource Type * ({wIsHuman ? humanResourceTypes.length : nonHumanResourceTypes.length} Available)
                  </label>
                  <select
                    value={wResourceType}
                    onChange={(e) => setWResourceType(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500"
                  >
                    {(wIsHuman ? humanResourceTypes : nonHumanResourceTypes).map((t) => (
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
                    value={wSpecialty}
                    onChange={(e) => setWSpecialty(e.target.value)}
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
                    value={wColorCode}
                    onChange={(e) => setWColorCode(e.target.value)}
                    placeholder="FFFFFF"
                    className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                    Operating From
                  </label>
                  <input
                    type="text"
                    value={wOperatingFrom}
                    onChange={(e) => setWOperatingFrom(e.target.value)}
                    placeholder="00:00"
                    className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                    Operating To
                  </label>
                  <input
                    type="text"
                    value={wOperatingTo}
                    onChange={(e) => setWOperatingTo(e.target.value)}
                    placeholder="23:55"
                    className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                    Departments (comma-separated or ALL)
                  </label>
                  <input
                    type="text"
                    value={wDepartments}
                    onChange={(e) => setWDepartments(e.target.value)}
                    placeholder="ALL"
                    className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                    Services (comma-separated or ALL)
                  </label>
                  <input
                    type="text"
                    value={wServices}
                    onChange={(e) => setWServices(e.target.value)}
                    placeholder="ALL"
                    className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Associated User Details (/addUsers) */}
          {activeStep === 2 && (
            <div className="space-y-4">
              <div className="border-b border-slate-800 pb-2 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-sky-600 text-white text-[11px] flex items-center justify-center font-bold">2</span>
                    Section 2: Associated User Details (/addUsers)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">Provision a linked client user account for this practitioner</p>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-sky-400">
                    <input
                      type="checkbox"
                      checked={wCreateUser}
                      onChange={(e) => setWCreateUser(e.target.checked)}
                      className="rounded border-slate-700 text-sky-600 focus:ring-0 w-4 h-4"
                    />
                    <span>Create Linked User Account</span>
                  </label>
                </div>
              </div>

              {/* Linked Step 1 Resource Status Banner */}
              {verifiedRemoteResourceId ? (
                <div className="p-2.5 bg-emerald-950/30 border border-emerald-500/30 rounded-lg flex items-center justify-between text-xs text-emerald-200">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Linked Step 1 Resource: <strong>{wResourceName}</strong> (Remote ID: <strong>{verifiedRemoteResourceId}</strong>)</span>
                  </div>
                  <span className="text-[10px] font-mono bg-emerald-900/60 text-emerald-300 px-2 py-0.5 rounded font-bold">VERIFIED</span>
                </div>
              ) : (
                <div className="p-2.5 bg-amber-950/30 border border-amber-500/30 rounded-lg flex items-center justify-between text-xs text-amber-200">
                  <div className="flex items-center gap-2">
                    <Info className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Step 1 Resource not created yet. Clicking <strong>Create User</strong> will automatically create & verify Resource first, then create User & assign Roles.</span>
                  </div>
                </div>
              )}

              {/* Sequential Execution Live Progress & Diagnostics */}
              {(isSubmittingSequential || sequentialFailure !== null || sequentialSteps.some((s) => s.status !== 'PENDING')) && (
                <div className={`p-3.5 rounded-xl border space-y-2.5 transition-all ${
                  sequentialFailure
                    ? 'bg-rose-950/40 border-rose-800/60'
                    : isSubmittingSequential
                    ? 'bg-sky-950/40 border-sky-800/60'
                    : 'bg-slate-900/60 border-slate-800'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold">
                      {isSubmittingSequential ? (
                        <>
                          <RefreshCw className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
                          <span className="text-sky-300">{sequentialActiveMessage || 'Executing sequential operations...'}</span>
                        </>
                      ) : sequentialFailure ? (
                        <>
                          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                          <span className="text-rose-300">Sequential Pipeline Halted at Stage: {sequentialFailure.failedStage}</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span className="text-emerald-300">All Sequential Operations Verified</span>
                        </>
                      )}
                    </div>
                    {sequentialFailure && sequentialFailure.runId && (
                      <span className="text-[10px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-white/5">
                        Run ID: {sequentialFailure.runId}
                      </span>
                    )}
                  </div>

                  {sequentialFailure && (
                    <div className="space-y-2">
                      <div className="text-xs text-rose-200/90 font-mono bg-rose-950/60 p-2.5 rounded-lg border border-rose-900/50 flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.5 rounded bg-rose-900 text-rose-200 text-[10px] font-bold">
                            {sequentialFailure.errorCode}
                          </span>
                          <span>{sequentialFailure.errorMessage}</span>
                        </div>
                      </div>

                      {sequentialFailure.verifiedStages && sequentialFailure.verifiedStages.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-300">
                          <span className="text-slate-400 font-semibold">Verified earlier stages:</span>
                          {sequentialFailure.verifiedStages.map((st) => (
                            <span
                              key={st.stage}
                              className="px-2 py-0.5 rounded-md bg-emerald-950 border border-emerald-800/60 text-emerald-300 font-mono text-[10px] flex items-center gap-1"
                            >
                              <Check className="w-3 h-3 text-emerald-400" />
                              <strong>{st.label}:</strong> {st.idOrValue}
                            </span>
                          ))}
                        </div>
                      )}

                      {sequentialFailure.failedStage === 'RESOURCE_USER_MAPPING' && (
                        <div className="pt-1 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleRetryMappingOnly}
                            disabled={isSubmittingSequential}
                            className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-sky-900/30"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isSubmittingSequential ? 'animate-spin' : ''}`} />
                            <span>Retry Mapping Only (/addParentResourceUser)</span>
                          </button>
                          <span className="text-[11px] text-slate-400 italic">
                            Retries only Step 4 without repeating Resource, User, or Role operations.
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 4 Stage Cards */}
                  <div className="pt-2 border-t border-white/5 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                    {sequentialSteps.map((step) => {
                      const isVerified = step.status === 'VERIFIED';
                      const isSkippedVerified = step.status === 'SKIPPED_ALREADY_VERIFIED';
                      const isInProgress = step.status === 'IN_PROGRESS';
                      const isFailed = step.status === 'FAILED';
                      const isUnresolved = step.status === 'UNRESOLVED';

                      const badgeClasses =
                        isVerified
                          ? 'bg-emerald-950/80 border-emerald-700/60 text-emerald-300'
                          : isSkippedVerified
                          ? 'bg-teal-950/80 border-teal-700/60 text-teal-300'
                          : isInProgress
                          ? 'bg-sky-950/80 border-sky-700/60 text-sky-300'
                          : isFailed
                          ? 'bg-rose-950/80 border-rose-700/60 text-rose-300'
                          : isUnresolved
                          ? 'bg-amber-950/80 border-amber-700/60 text-amber-300'
                          : 'bg-slate-900/80 border-slate-800 text-slate-400';

                      return (
                        <div key={step.stage} className={`p-2 rounded-lg border ${badgeClasses} space-y-1`}>
                          <div className="font-semibold truncate" title={step.label}>{step.label}</div>
                          <div className="flex items-center gap-1 font-mono font-bold text-[10px]">
                            {isVerified && <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />}
                            {isSkippedVerified && <CheckCircle2 className="w-3 h-3 text-teal-400 shrink-0" />}
                            {isInProgress && <RefreshCw className="w-3 h-3 text-sky-400 animate-spin shrink-0" />}
                            {isFailed && <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />}
                            {isUnresolved && <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />}
                            <span>{step.status}</span>
                          </div>
                          {step.detail && (
                            <div className="text-[10px] opacity-80 line-clamp-2" title={step.detail}>
                              {step.detail}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Options Synchronization Toolbar */}
              <div className="flex items-center justify-between px-3 py-2 bg-slate-950/80 border border-slate-800 rounded-lg text-xs">
                <div className="flex items-center gap-2 text-slate-400">
                  <span>Target Client:</span>
                  <strong className="text-white font-mono">{selectedClient?.clientCode}</strong>
                  <span className="text-slate-600">•</span>
                  <span className="text-slate-400">Add User Portal: <code className="text-sky-300">/addUsers</code></span>
                </div>
                <div className="flex items-center gap-3">
                  {userOptionsSyncTime && !isLoadingRoles && !userOptionsError && (
                    <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Options synced at {userOptionsSyncTime} ({availableRoles.length} roles, {nationalities.length} nations)
                    </span>
                  )}
                  {userOptionsError && (
                    <span className="text-[11px] text-rose-400 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {userOptionsError}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={isLoadingRoles || isLoadingNationalities}
                    onClick={() => loadUserFormOptions(selectedClientId, true)}
                    className="text-[11px] text-sky-400 hover:text-sky-300 disabled:opacity-50 flex items-center gap-1 font-medium transition-colors"
                    title="Reload live options directly from Simplex Add User page"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRoles ? 'animate-spin' : ''}`} />
                    Refresh Options
                  </button>
                </div>
              </div>

              {/* Verified Remote User Banner */}
              {verifiedRemoteUserId && (
                <div className="p-3 bg-emerald-950/80 border border-emerald-800 rounded-lg text-emerald-200 flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-xs">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>User verified on client: <strong className="font-mono text-white">{verifiedRemoteUserId}</strong></span>
                  </div>
                  <span className="text-[11px] bg-emerald-900/80 text-emerald-300 px-2 py-0.5 rounded font-mono">
                    Provisioned & Verified (0 Duplicate Creation)
                  </span>
                </div>
              )}

              {!wCreateUser ? (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-900/60 rounded-xl border border-slate-800 text-xs text-slate-400">
                    <span className="font-semibold text-slate-300 block mb-1">Linked user creation is disabled.</span>
                    You can optionally specify an existing portal username to link this resource to, or leave empty to skip user mapping.
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                      Existing Portal Username to Map (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. dr_faisal"
                      value={wMappingUsername}
                      onChange={(e) => setWMappingUsername(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500 font-mono"
                    />
                    <span className="text-[11px] text-slate-500 mt-1 block">
                      Leave empty to skip user mapping entirely
                    </span>
                  </div>

                  <div className="p-4 bg-slate-900/60 rounded-xl border border-slate-800 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-slate-200">Is Shown In Registration *</div>
                      <div className="text-[11px] text-slate-400">Controls practitioner visibility in patient intake & appointment desks</div>
                    </div>
                    <select
                      value={wIsShownInRegistration ? 'Yes' : 'No'}
                      onChange={(e) => setWIsShownInRegistration(e.target.value === 'Yes')}
                      className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-500"
                    >
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-3 bg-slate-900/40 rounded-lg border border-slate-800/60 text-[11px] text-slate-400 flex items-start gap-2">
                    <Shield className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>
                      Password will be securely auto-generated and displayed once in an ephemeral modal. Passwords are never stored in plain text.
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                      User Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. dr_faisal"
                      value={wUsername}
                      onChange={(e) => setWUsername(e.target.value.toLowerCase().trim())}
                      className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500 font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                        First Name *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Faisal"
                        value={wFirstName}
                        onChange={(e) => setWFirstName(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                        Middle Name
                      </label>
                      <input
                        type="text"
                        placeholder="Ahmed"
                        value={wMiddleName}
                        onChange={(e) => setWMiddleName(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                        Last Name *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Al-Harbi"
                        value={wLastName}
                        onChange={(e) => setWLastName(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                        Email Address
                      </label>
                      <input
                        type="email"
                        placeholder="faisal@example.com"
                        value={wEmail}
                        onChange={(e) => setWEmail(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                        Mobile Number *
                      </label>
                      <input
                        type="tel"
                        required
                        placeholder="+966500000000"
                        value={wMobile}
                        onChange={(e) => setWMobile(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500 font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                      Nationality * {nationalities.length > 0 && <span className="text-slate-500 font-normal">({nationalities.length} options)</span>}
                    </label>
                    <select
                      value={wNationality}
                      onChange={(e) => setWNationality(e.target.value)}
                      disabled={isLoadingNationalities}
                      className="w-full bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-sky-500 disabled:opacity-50"
                    >
                      {isLoadingNationalities && nationalities.length === 0 && (
                        <option value="">Loading nationalities…</option>
                      )}
                      {nationalities.map((n) => (
                        <option key={n.value} value={n.value}>
                          {n.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2 pt-1 border-t border-slate-800/60">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-semibold text-slate-300 uppercase">
                        User Role(s) *
                      </label>
                      <span className="text-[11px] text-sky-400 font-medium">
                        {selectedRoles.length} {selectedRoles.length === 1 ? 'role' : 'roles'} selected
                      </span>
                    </div>

                    {/* Selected Role Chips */}
                    <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2 bg-slate-950/80 border border-slate-800 rounded-lg">
                      {selectedRoles.length === 0 ? (
                        <span className="text-[11px] text-slate-500 italic p-0.5">
                          No roles selected — select one or multiple roles below
                        </span>
                      ) : (
                        selectedRoles.map((role) => (
                          <span
                            key={role}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-sky-950/80 text-sky-300 border border-sky-800/80 rounded-md text-[11px] font-medium"
                          >
                            <span>{role}</span>
                            <button
                              type="button"
                              onClick={() => setSelectedRoles((prev) => prev.filter((r) => r !== role))}
                              className="hover:text-red-400 p-0.5 rounded transition-colors"
                              title={`Remove ${role}`}
                              aria-label={`Remove role ${role}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))
                      )}
                    </div>

                    {/* Role Search & Selection List */}
                    <div className="space-y-1">
                      <input
                        type="text"
                        placeholder="Filter available client roles…"
                        value={roleSearch}
                        onChange={(e) => setRoleSearch(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-white text-xs focus:outline-none focus:border-sky-500"
                      />

                      <div className="max-h-36 overflow-y-auto bg-slate-950 border border-slate-800 rounded-lg divide-y divide-slate-800/50">
                        {isLoadingRoles ? (
                          <div className="p-2 text-[11px] text-slate-500 italic">Loading roles…</div>
                        ) : (
                          (() => {
                            const allRoles = availableRoles;
                            const filtered = allRoles.filter((r) =>
                              !roleSearch || r.toLowerCase().includes(roleSearch.toLowerCase())
                            );

                            if (filtered.length === 0) {
                              return <div className="p-2 text-[11px] text-slate-500 italic">{availableRoles.length === 0 ? 'No roles loaded. Click Refresh Options above.' : 'No matching roles found'}</div>;
                            }

                            return filtered.map((role) => {
                              const isSelected = selectedRoles.includes(role);
                              return (
                                <button
                                  key={role}
                                  type="button"
                                  onClick={() => {
                                    setSelectedRoles((prev) =>
                                      isSelected ? prev.filter((r) => r !== role) : [...prev, role]
                                    );
                                  }}
                                  className={`w-full px-2.5 py-1.5 text-left text-[11px] flex items-center justify-between transition-colors ${
                                    isSelected
                                      ? 'bg-sky-950/60 text-sky-200 font-medium'
                                      : 'hover:bg-slate-900 text-slate-300'
                                  }`}
                                >
                                  <span>{role}</span>
                                  {isSelected && <Check className="w-3.5 h-3.5 text-sky-400" />}
                                </button>
                              );
                            });
                          })()
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Optional File Uploads */}
                  <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-800">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1">Signature</label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleFileToBase64(f, (b64, name) => {
                            setWSignatureBase64(b64);
                            setWSignatureFilename(name);
                          });
                        }}
                        className="text-[11px] text-slate-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-slate-800 file:text-slate-300 w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1">Stamp</label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleFileToBase64(f, (b64, name) => {
                            setWStampBase64(b64);
                            setWStampFilename(name);
                          });
                        }}
                        className="text-[11px] text-slate-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-slate-800 file:text-slate-300 w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1">Profile Photo</label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleFileToBase64(f, (b64, name) => {
                            setWProfileBase64(b64);
                            setWProfileFilename(name);
                          });
                        }}
                        className="text-[11px] text-slate-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-slate-800 file:text-slate-300 w-full"
                      />
                    </div>
                  </div>

                  <div className="p-4 bg-slate-900/60 rounded-xl border border-slate-800 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-slate-200">Is Shown In Registration *</div>
                      <div className="text-[11px] text-slate-400">Controls practitioner visibility in patient intake & appointment desks</div>
                    </div>
                    <select
                      value={wIsShownInRegistration ? 'Yes' : 'No'}
                      onChange={(e) => setWIsShownInRegistration(e.target.value === 'Yes')}
                      className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-500"
                    >
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: eClaim Configuration */}
          {activeStep === 3 && (() => {
            const activeEclaimUser = wUsername.trim() || wMappingUsername.trim() || wResourceName.trim() || 'Active Practitioner';
            const resolvedEclaimEndpoint = eclaimOptions?.endpoint || eclaimOptions?.eclaimRoute || '/addUserEclaim';
            const isEclaimSupported = eclaimOptions
              ? (eclaimOptions.supported !== false && eclaimOptions.isSupported !== false)
              : true;

            return (
              <div className="space-y-4">
                <div className="border-b border-slate-800 pb-2 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-sky-600 text-white text-[11px] flex items-center justify-center font-bold">3</span>
                      Section 3: eClaim User Configuration
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">Insurance billing identifier and provider registry credentials</p>
                  </div>
                  {isEclaimSupported && (
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-amber-400">
                      <input
                        type="checkbox"
                        checked={wEclaimEnabled}
                        onChange={(e) => setWEclaimEnabled(e.target.checked)}
                        className="rounded border-slate-700 text-amber-600 focus:ring-0 w-4 h-4"
                      />
                      <span>Enable eClaim User Link</span>
                    </label>
                  )}
                </div>

                {!isEclaimSupported ? (
                  <div className="p-4 bg-slate-900/60 rounded-xl border border-slate-800 text-xs text-slate-400 flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                    <div>
                      <div className="font-semibold text-slate-300">eClaim Endpoint Not Configured</div>
                      <div className="text-[11px] text-slate-500">
                        The current client environment does not have a registered eClaim portal route. This section will be safely skipped.
                      </div>
                    </div>
                  </div>
                ) : !wEclaimEnabled ? (
                  <div className="p-6 bg-slate-900/60 rounded-xl border border-slate-800 text-xs text-slate-400 text-center space-y-3">
                    <p>eClaim configuration is currently optional and disabled for this practitioner.</p>
                    <button
                      type="button"
                      onClick={() => setWEclaimEnabled(true)}
                      className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs transition-colors"
                    >
                      Enable & Configure eClaim Link
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Live Screen Target URL Banner */}
                    <div className="flex items-center justify-between px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-300 shadow-inner">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <Globe className="w-4 h-4 text-amber-500 shrink-0" />
                        <span className="text-slate-500 shrink-0">Simplex Route:</span>
                        <span className="text-amber-400 font-semibold truncate">{resolvedEclaimEndpoint}</span>
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 shrink-0">
                        LIVE CONNECTED
                      </span>
                    </div>

                    {/* Live eClaim Execution Progress & Status */}
                    {isSubmittingEclaimOnly && (
                      <div className="p-3.5 rounded-xl border bg-sky-950/40 border-sky-800/60 flex items-center gap-3 text-xs">
                        <RefreshCw className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
                        <span className="text-sky-300 font-medium">Configuring and verifying eClaim on client portal (/addUserEclaim)...</span>
                      </div>
                    )}
                    {verifiedEclaimStatus && !isSubmittingEclaimOnly && (
                      <div className="p-3.5 rounded-xl border bg-emerald-950/40 border-emerald-800/60 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span className="text-emerald-300 font-semibold">eClaim Verified & Linked Successfully</span>
                        </div>
                        <span className="text-[11px] text-emerald-400 font-mono font-bold px-2 py-0.5 rounded bg-emerald-900/50 border border-emerald-700/50">
                          STATUS: {verifiedEclaimStatus}
                        </span>
                      </div>
                    )}

                    {/* ADD - USER ECLAIM LINK Card matching Image 2 */}
                    <div className="rounded-xl border border-amber-600/40 overflow-hidden bg-slate-950/90 shadow-xl">
                      {/* Screen Header matching Image 2 */}
                      <div className="bg-[#b85d19] px-4 py-2.5 flex items-center justify-between shadow-inner">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
                          <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                            ADD - USER ECLAIM LINK
                          </h4>
                        </div>
                        <span className="text-[11px] text-amber-100 font-mono opacity-90">
                          /addUserEclaim
                        </span>
                      </div>

                      {/* Form fields matching Image 2 */}
                      <div className="p-4 space-y-3.5 bg-slate-900/30">
                        {/* Row 1: Eclaim Link * */}
                        <div className="grid grid-cols-12 items-center gap-3">
                          <label className="col-span-3 text-right text-xs font-medium text-slate-300">
                            Eclaim Link <span className="text-red-400">*</span>
                          </label>
                          <div className="col-span-9">
                            <input
                              type="text"
                              placeholder={activeEclaimUser ? `e.g. ${activeEclaimUser}` : 'e.g. DrName or Eclaim Link Name'}
                              value={wEclaimLink}
                              onChange={(e) => setWEclaimLink(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 text-slate-100 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-amber-500 font-mono shadow-inner"
                            />
                          </div>
                        </div>

                        {/* Row 2: Eclaim Name * */}
                        <div className="grid grid-cols-12 items-center gap-3">
                          <label className="col-span-3 text-right text-xs font-medium text-slate-300">
                            Eclaim Name <span className="text-red-400">*</span>
                          </label>
                          <div className="col-span-9">
                            <input
                              type="text"
                              placeholder={activeEclaimUser}
                              value={wEclaimName || activeEclaimUser}
                              onChange={(e) => setWEclaimName(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 text-slate-100 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-amber-500 font-mono font-semibold shadow-inner"
                            />
                          </div>
                        </div>

                        {/* Row 3: Eclaim Password * */}
                        <div className="grid grid-cols-12 items-center gap-3">
                          <label className="col-span-3 text-right text-xs font-medium text-slate-300">
                            Eclaim Password <span className="text-red-400">*</span>
                          </label>
                          <div className="col-span-9 relative">
                            <input
                              type={showEclaimPassword ? 'text' : 'password'}
                              placeholder="Enter eClaim Password"
                              value={wEclaimPassword}
                              onChange={(e) => setWEclaimPassword(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 text-slate-100 text-xs rounded-lg px-3 py-2 pr-10 focus:outline-none focus:border-amber-500 font-mono shadow-inner text-amber-200"
                            />
                            <button
                              type="button"
                              onClick={() => setShowEclaimPassword(!showEclaimPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                              tabIndex={-1}
                              title={showEclaimPassword ? "Hide password" : "Show password"}
                            >
                              {showEclaimPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        {/* Row 4: License No */}
                        <div className="grid grid-cols-12 items-center gap-3">
                          <label className="col-span-3 text-right text-xs font-medium text-slate-300">
                            License No
                          </label>
                          <div className="col-span-9">
                            <input
                              type="text"
                              placeholder="Medical License No"
                              value={wEclaimLicense}
                              onChange={(e) => setWEclaimLicense(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 text-slate-100 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-amber-500 font-mono shadow-inner"
                            />
                          </div>
                        </div>

                        {/* Row 5: Insurance Company */}
                        <div className="grid grid-cols-12 items-center gap-3">
                          <label className="col-span-3 text-right text-xs font-medium text-slate-300">
                            Insurance Company
                          </label>
                          <div className="col-span-9">
                            <select
                              value={wEclaimInsuranceCompany}
                              onChange={(e) => setWEclaimInsuranceCompany(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 text-slate-100 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-amber-500 shadow-inner"
                            >
                              <option value="">-- Insurance Company --</option>
                              <option value="Tawuniya">Tawuniya (The Company for Cooperative Insurance)</option>
                              <option value="Bupa Arabia">Bupa Arabia for Cooperative Insurance</option>
                              <option value="Medgulf">Medgulf (The Mediterranean & Gulf Insurance)</option>
                              <option value="Malath">Malath Cooperative Insurance</option>
                              <option value="Al Rajhi Takaful">Al Rajhi Takaful</option>
                              <option value="AXA Cooperative">AXA Cooperative Insurance (GIG)</option>
                              <option value="Allianz Saudi Fransi">Allianz Saudi Fransi</option>
                              <option value="Chubb Arabia">Chubb Arabia Cooperative Insurance</option>
                              <option value="United Cooperative Assurance">United Cooperative Assurance (UCA)</option>
                              <option value="Saudi Enaya">Saudi Enaya</option>
                              <option value="Arabian Shield">Arabian Shield Cooperative</option>
                              <option value="Al Sagr">Al Sagr Cooperative Insurance</option>
                              <option value="Buruj">Buruj Cooperative Insurance</option>
                            </select>
                          </div>
                        </div>

                        {/* Row 6: Branch Name */}
                        <div className="grid grid-cols-12 items-center gap-3">
                          <label className="col-span-3 text-right text-xs font-medium text-slate-300">
                            Branch Name
                          </label>
                          <div className="col-span-9 text-xs text-amber-200 font-semibold px-3 py-2 bg-slate-950/60 rounded-lg border border-slate-800/80">
                            {wBranchName || clients.find((c) => c.id === selectedClientId)?.clientName || 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC'}
                          </div>
                        </div>

                        {/* Row 7: Old Eclaim Name */}
                        <div className="grid grid-cols-12 items-center gap-3">
                          <label className="col-span-3 text-right text-xs font-medium text-slate-300">
                            Old Eclaim Name
                          </label>
                          <div className="col-span-9">
                            <input
                              type="text"
                              placeholder="Previous eClaim User Identifier"
                              value={wEclaimOldName}
                              onChange={(e) => setWEclaimOldName(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 text-slate-100 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-amber-500 font-mono shadow-inner"
                            />
                          </div>
                        </div>

                        {/* Row 8: Old Eclaim Password */}
                        <div className="grid grid-cols-12 items-center gap-3">
                          <label className="col-span-3 text-right text-xs font-medium text-slate-300">
                            Old Eclaim Password
                          </label>
                          <div className="col-span-9 relative">
                            <input
                              type={showOldEclaimPassword ? 'text' : 'password'}
                              placeholder="Old eClaim Password (optional)"
                              value={wEclaimOldPassword}
                              onChange={(e) => setWEclaimOldPassword(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 text-slate-100 text-xs rounded-lg px-3 py-2 pr-10 focus:outline-none focus:border-amber-500 font-mono shadow-inner text-amber-200"
                            />
                            <button
                              type="button"
                              onClick={() => setShowOldEclaimPassword(!showOldEclaimPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                              tabIndex={-1}
                              title={showOldEclaimPassword ? "Hide password" : "Show password"}
                            >
                              {showOldEclaimPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        {/* Row 9: Old License No */}
                        <div className="grid grid-cols-12 items-center gap-3">
                          <label className="col-span-3 text-right text-xs font-medium text-slate-300">
                            Old License No
                          </label>
                          <div className="col-span-9">
                            <input
                              type="text"
                              placeholder="Previous License No"
                              value={wEclaimOldLicenseNo}
                              onChange={(e) => setWEclaimOldLicenseNo(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 text-slate-100 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-amber-500 font-mono shadow-inner"
                            />
                          </div>
                        </div>

                        {/* Row 10: Actual License No */}
                        <div className="grid grid-cols-12 items-center gap-3">
                          <label className="col-span-3 text-right text-xs font-medium text-slate-300">
                            Actual License No
                          </label>
                          <div className="col-span-9">
                            <input
                              type="text"
                              placeholder="Actual Medical License No"
                              value={wEclaimActualLicenseNo}
                              onChange={(e) => setWEclaimActualLicenseNo(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 text-slate-100 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-amber-500 font-mono shadow-inner"
                            />
                          </div>
                        </div>

                        {/* Automatic User Link Target (Auto-selected by automation after resource & user creation) */}
                        <div className="mt-3 pt-3 border-t border-slate-800/80">
                          <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2.5">
                              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                              <span className="text-slate-400">Target eClaim User:</span>
                              <span className="text-amber-300 font-mono font-bold">{activeEclaimUser}</span>
                            </div>
                            <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Auto-linked & selected upon creation
                            </span>
                          </div>
                        </div>

                        {/* Process eClaim Action Button inside card */}
                        <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                          <span className="text-[11px] text-slate-400">
                            Configure user eClaim credentials and link on Simplex portal
                          </span>
                          <div className="flex items-center gap-2">
                            {isSubmittingEclaimOnly && (
                              <button
                                type="button"
                                onClick={handleForceUnlock}
                                className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-semibold cursor-pointer"
                                title="Unlock controls"
                              >
                                Unlock
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={handleProcessEclaimStep3}
                              disabled={isSubmittingEclaimOnly}
                              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all shadow-md shadow-emerald-900/30 flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                            >
                              {isSubmittingEclaimOnly ? (
                                <RefreshCw className="w-4 h-4 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-4 h-4" />
                              )}
                              <span>
                                {isSubmittingEclaimOnly
                                  ? 'Configuring eClaim…'
                                  : verifiedEclaimStatus
                                  ? `eClaim Verified (${verifiedEclaimStatus})`
                                  : 'Process eClaim'}
                              </span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* STEP 4: EMR Form Assignment (/emrPanelSelection) */}
          {activeStep === 4 && (
            <div className="space-y-4">
              <div className="border-b border-slate-800 pb-2 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-sky-600 text-white text-[11px] flex items-center justify-center font-bold">4</span>
                    Section 4: EMR Form Assignment (/emrPanelSelection)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">Authoritative Form Master extraction, encounter groups, and default form selector</p>
                </div>
                <div className="text-xs font-semibold text-sky-400">
                  {wSelectedFormIds.length} forms selected
                </div>
              </div>

              {/* User Scope Banner */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-sky-600/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
                    <User className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                      Selected Practitioner User
                    </div>
                    <div className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      <span>{activeEmrUsername}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-sky-950/80 border border-sky-800/60 text-sky-300 font-mono">
                        {wIsHuman ? 'Human Resource' : 'Non-Human Resource'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <div className="text-right">
                    <div className="text-slate-400 text-[11px]">Assigned Forms:</div>
                    <div className="font-semibold text-sky-400">{wSelectedFormIds.length} assigned</div>
                  </div>
                  <div className="text-right border-l border-slate-800 pl-4">
                    <div className="text-slate-400 text-[11px]">Default Form:</div>
                    <div className="font-semibold text-emerald-400 font-mono">
                      {wDefaultFormId || 'None'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Live Status / Verification Required Alert */}
              {(!emrFormsResult?.verified || emrFormsList.length === 0) && !isLoadingEmrForms && (
                <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200 text-xs">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-amber-300 text-xs">
                        Live forms unavailable / verification required
                      </div>
                      <p className="mt-0.5 text-amber-200/80 text-[11px] leading-relaxed">
                        {emrFormsResult?.message ||
                          `No verified live Form Master data is currently available from client at ${emrFormsResult?.emrRoute || '/emrPanelSelection'}.`}
                      </p>
                      <p className="mt-1 text-amber-300/70 text-[11px]">
                        Synthetic mock forms have been removed to protect data integrity. Real forms will populate once live client connectivity is verified.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Group & Encounter Type Options */}
              <div className="grid grid-cols-2 gap-4 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase mb-1">
                    Encounter Type
                  </label>
                  <select
                    value={wFormEncounterType}
                    onChange={(e) => setWFormEncounterType(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-500"
                  >
                    <option value="OP">Outpatient (OP)</option>
                    <option value="IP">Inpatient (IP)</option>
                    <option value="ER">Emergency (ER)</option>
                    <option value="DAY_CARE">Day Care</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase mb-1">
                    Form Group
                  </label>
                  <input
                    type="text"
                    value={wFormGroup}
                    onChange={(e) => setWFormGroup(e.target.value)}
                    placeholder="e.g. CONSULTATION"
                    className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              {/* Form Filter & Search Bar */}
              <div className="flex items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search live forms by ID, name, group, or encounter type…"
                    value={wFormSearch}
                    onChange={(e) => {
                      setWFormSearch(e.target.value);
                      setWFormPage(1);
                    }}
                    className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg pl-8 pr-3 py-1.5 placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllFilteredForms}
                    disabled={emrFormsList.length === 0}
                    className="text-[11px] text-sky-400 hover:text-sky-300 font-semibold px-2.5 py-1 rounded bg-slate-900 border border-slate-800 disabled:opacity-40"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={deselectAllForms}
                    disabled={wSelectedFormIds.length === 0}
                    className="text-[11px] text-slate-400 hover:text-slate-300 font-semibold px-2.5 py-1 rounded bg-slate-900 border border-slate-800 disabled:opacity-40"
                  >
                    Clear All
                  </button>
                </div>
              </div>

              {/* Forms Table */}
              <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/60 max-h-72 overflow-y-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 w-12 text-center">Assign</th>
                      <th className="px-3 py-2 w-14 text-center">Default</th>
                      <th className="px-3 py-2 font-mono">Form ID</th>
                      <th className="px-3 py-2">Form Name</th>
                      <th className="px-3 py-2">Encounter Type</th>
                      <th className="px-3 py-2">Group</th>
                      <th className="px-3 py-2">Assigned User</th>
                      <th className="px-3 py-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {isLoadingEmrForms ? (
                      <tr>
                        <td colSpan={8} className="text-center py-8 text-slate-500">
                          <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1 text-sky-400" />
                          Extracting live Form Master from client…
                        </td>
                      </tr>
                    ) : emrFormsList.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center py-8 text-slate-400">
                          <AlertTriangle className="w-5 h-5 text-amber-400 mx-auto mb-2 opacity-80" />
                          <div className="font-semibold text-slate-300">Live forms unavailable / verification required</div>
                          <div className="text-[11px] text-slate-500 mt-1">
                            No verified live Form Master items found for client endpoint {emrFormsResult?.emrRoute || '/emrPanelSelection'}.
                          </div>
                        </td>
                      </tr>
                    ) : paginatedForms.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center py-6 text-slate-500">
                          No forms match your search criteria "{wFormSearch}".
                        </td>
                      </tr>
                    ) : (
                      paginatedForms.map((f) => {
                        const isSelected = wSelectedFormIds.includes(f.formId);
                        const isDefault = wDefaultFormId === f.formId;
                        return (
                          <tr
                            key={f.formId}
                            className={`hover:bg-slate-800/40 transition-colors ${
                              isSelected ? 'bg-sky-950/20' : ''
                            }`}
                          >
                            <td className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleFormAssign(f.formId)}
                                className="rounded border-slate-700 text-sky-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="radio"
                                name="default_emr_form"
                                checked={isDefault}
                                onChange={() => toggleFormDefault(f.formId)}
                                className="text-emerald-500 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                              />
                            </td>
                            <td className="px-3 py-2 font-mono text-sky-400 font-semibold text-[11px]">
                              {f.formId}
                            </td>
                            <td className="px-3 py-2 text-slate-200 font-medium">
                              {f.formName}
                            </td>
                            <td className="px-3 py-2 text-slate-400 text-[11px]">
                              <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 font-mono text-[10px]">
                                {f.encounterType || wFormEncounterType || 'OP'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-400 text-[11px]">
                              {f.group || wFormGroup || 'GENERAL'}
                            </td>
                            <td className="px-3 py-2 text-slate-300 font-mono text-[11px]">
                              {isSelected ? (
                                <span className="text-sky-300 bg-sky-950/80 px-1.5 py-0.5 rounded border border-sky-800/50">
                                  {activeEmrUsername}
                                </span>
                              ) : (
                                <span className="text-slate-600">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span
                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  f.isActive !== false
                                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/40'
                                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                                }`}
                              >
                                {f.isActive !== false ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Form Pagination */}
              <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                <div>
                  Showing {paginatedForms.length} of {filteredEmrForms.length} forms
                  {emrFormsList.length > 0 && (
                    <span className="text-slate-500 ml-1">
                      (Total {emrFormsList.length})
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setWFormPage((p) => Math.max(1, p - 1))}
                    disabled={wFormPage <= 1}
                    className="p-1 rounded border border-slate-800 disabled:opacity-40"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="px-2">
                    {wFormPage} / {formTotalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setWFormPage((p) => Math.min(formTotalPages, p + 1))}
                    disabled={wFormPage >= formTotalPages}
                    className="p-1 rounded border border-slate-800 disabled:opacity-40"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Review Summary Box */}
              <div className="p-3.5 bg-slate-900/90 rounded-xl border border-slate-800 space-y-2 text-xs mt-3">
                <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-sky-400" />
                  Provisioning Summary Checklist
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 pt-1">
                  <div>
                    • Resource: <strong className="text-slate-200">{wResourceName || '—'}</strong> ({wResourceType})
                  </div>
                  <div>
                    • Type: <strong className="text-slate-200">{wIsHuman ? 'Human Practitioner' : 'Non-Human'}</strong>
                  </div>
                  <div>
                    • User Account: <strong className="text-slate-200">{wCreateUser ? wUsername || 'Will Create' : 'Skipped'}</strong>
                  </div>
                  <div>
                    • Mapping: <strong className="text-slate-200">Registration: {wIsShownInRegistration ? 'Yes' : 'No'}</strong>
                  </div>
                  <div>
                    • eClaim: <strong className="text-slate-200">{wEclaimEnabled ? `Provider: ${wEclaimProviderId || 'Yes'}` : 'Skipped'}</strong>
                  </div>
                  <div>
                    • EMR Forms: <strong className="text-slate-200">{wSelectedFormIds.length} assigned</strong> (Default: {wDefaultFormId || 'None'})
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Stepper Navigation Footer */}
          <div className="flex items-center justify-between pt-4 border-t border-surface-border">
            <button
              type="button"
              onClick={() => {
                if (activeStep > 1) setActiveStep(activeStep - 1);
                else setIsCreateModalOpen(false);
              }}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-colors"
            >
              {activeStep === 1 ? 'Cancel' : 'Previous Step'}
            </button>

            <div className="flex items-center gap-2">
              {activeStep === 1 && isResourceOnlyUncertain && (
                <button
                  type="button"
                  onClick={handleReconcileResourceOnly}
                  disabled={isReconcilingResourceOnly}
                  className="px-3 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all shadow-md shadow-amber-900/30 flex items-center gap-1.5"
                  title={`Run ID: ${resourceOnlyRunId} is in-progress or uncertain. Click to reconcile remotely read-only.`}
                >
                  {isReconcilingResourceOnly ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="w-3.5 h-3.5" />
                  )}
                  <span>Reconcile Run ({resourceOnlyRunId?.slice(0, 8)})</span>
                </button>
              )}

              {activeStep === 1 && (
                <button
                  type="button"
                  onClick={handleCreateResourceOnly}
                  disabled={isCreateResourceOnlyDisabled}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all shadow-md shadow-emerald-900/30 flex items-center gap-2"
                  title={
                    !selectedClientId
                      ? 'Please select a client first'
                      : !wResourceName.trim()
                      ? 'Resource Name is required in Step 1'
                      : !wResourceType
                      ? 'Resource Type is required in Step 1'
                      : !wSpecialty
                      ? 'Specialty is required in Step 1'
                      : isResourceOnlyUncertain
                      ? `Previous run (${resourceOnlyRunId}) has an uncertain or in-progress outcome. Please reconcile status before retrying.`
                      : verifiedRemoteResourceId
                      ? `Resource '${wResourceName}' is already verified on remote client (Remote ID: ${verifiedRemoteResourceId})`
                      : 'Step 1: Create and verify Resource only on Simplex /addResourceParentDetails'
                  }
                >
                  {isSubmittingResourceOnly ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>
                    {isSubmittingResourceOnly
                      ? 'Creating Resource…'
                      : verifiedRemoteResourceId
                      ? `Resource Verified (${verifiedRemoteResourceId})`
                      : 'Create Resource'}
                  </span>
                </button>
              )}

              {activeStep === 2 && wCreateUser && (
                <button
                  type="button"
                  onClick={handleCreateUserStep2}
                  disabled={isSubmittingSequential}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all shadow-md shadow-emerald-900/30 flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                  title={
                    !selectedClientId
                      ? 'Please select a client first'
                      : isSubmittingSequential
                      ? 'Sequential workflow is executing...'
                      : 'Step 2: Sequential Workflow (Creates/verifies Resource first if not already created, then creates User on /addUsers and assigns Role on /userRole)'
                  }
                >
                  {isSubmittingSequential ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>
                    {isSubmittingSequential
                      ? 'Creating User & Assigning Role…'
                      : verifiedRemoteUserId && verifiedRemoteRoles.length > 0
                      ? `User & Roles Verified (${verifiedRemoteUserId})`
                      : 'Create User'}
                  </span>
                </button>
              )}

              {activeStep === 3 && (
                <div className="flex items-center gap-2">
                  {isSubmittingEclaimOnly && (
                    <button
                      type="button"
                      onClick={handleForceUnlock}
                      className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-semibold cursor-pointer"
                      title="Unlock controls"
                    >
                      Unlock
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleProcessEclaimStep3}
                    disabled={isSubmittingEclaimOnly}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all shadow-md shadow-emerald-900/30 flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                    title={
                      !selectedClientId
                        ? 'Please select a client first'
                        : isSubmittingEclaimOnly
                        ? 'eClaim workflow is executing...'
                        : 'Step 3: Process & verify eClaim configuration on Simplex /addUserEclaim'
                    }
                  >
                    {isSubmittingEclaimOnly ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    <span>
                      {isSubmittingEclaimOnly
                        ? 'Configuring eClaim…'
                        : verifiedEclaimStatus
                        ? `eClaim Verified (${verifiedEclaimStatus})`
                        : 'Process eClaim'}
                    </span>
                  </button>
                </div>
              )}

              {activeStep < 4 ? (
                <button
                  type="button"
                  onClick={() => setActiveStep(activeStep + 1)}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold transition-all shadow-md shadow-sky-900/30"
                >
                  Next Step
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  {isSubmittingIntegrated && (
                    <button
                      type="button"
                      onClick={handleForceUnlock}
                      className="px-3 py-2 bg-rose-700/80 hover:bg-rose-600 text-white rounded-lg text-xs font-bold transition-all shadow flex items-center gap-1.5 cursor-pointer"
                      title="Force reset if workflow is stuck or taking too long"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset / Unlock</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (!wResourceName.trim()) {
                        setActiveStep(1);
                        setErrorMessage('Resource Name is required in Step 1 before executing provisioning.');
                        return;
                      }
                      handleSubmitIntegrated();
                    }}
                    disabled={isSubmittingIntegrated || isSubmittingResourceOnly}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all shadow-md shadow-emerald-900/30 flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                    title={
                      !wResourceName.trim()
                        ? 'Resource Name (Step 1) is required to execute provisioning'
                        : isSubmittingIntegrated
                        ? 'Executing workflow...'
                        : 'Execute full 6-step integrated provisioning'
                    }
                  >
                    {isSubmittingIntegrated ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    <span>{isSubmittingIntegrated ? 'Executing Workflow…' : 'Execute Provisioning'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </Modal>

      {/* STEP 1 & 2 SEQUENTIAL PROVISIONING SUCCESS POPUP */}
      <Modal
        isOpen={isSuccessPopupOpen}
        onClose={() => {
          setIsSuccessPopupOpen(false);
          setSuccessPopupData(null);
        }}
        title={successPopupData?.eclaimStatus ? "Provisioning Complete: Resource, User, Role & eClaim Verified" : "Provisioning Complete: Resource, User, Role & Mapping Verified"}
        maxWidth="max-w-lg"
      >
        {successPopupData && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-emerald-950/40 border border-emerald-500/40 rounded-xl">
              <div className="w-9 h-9 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Sequential Verification Succeeded</h4>
                <p className="text-xs text-emerald-300/90">All 4 operations were remotely verified on the client portal.</p>
              </div>
            </div>

            <div className="space-y-2.5 text-xs">
              {/* Resource Item */}
              <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                  <span>Step 1: Resource Master</span>
                  <span className="text-emerald-400 font-bold">✓ Verified</span>
                </div>
                <div className="text-sm font-bold text-white">{successPopupData.resourceName}</div>
                <div className="text-emerald-300 font-mono text-[11px]">
                  Remote ID: <strong>{successPopupData.remoteResourceId}</strong> (/ResourceParent)
                </div>
              </div>

              {/* User Item */}
              <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                  <span>Step 2: User Account</span>
                  <span className="text-emerald-400 font-bold">✓ Verified</span>
                </div>
                <div className="text-sm font-mono font-bold text-white">{successPopupData.username}</div>
                <div className="text-emerald-300 font-mono text-[11px]">
                  Portal Route: /users
                </div>
              </div>

              {/* Role Item */}
              <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1.5">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                  <span>Step 2: Assigned Role(s)</span>
                  <span className="text-emerald-400 font-bold">✓ Verified</span>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {successPopupData.assignedRoles.map((role) => (
                    <span
                      key={role}
                      className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold"
                    >
                      {role}
                    </span>
                  ))}
                </div>
                <div className="text-emerald-300 font-mono text-[11px]">
                  Role Registry: /userRole
                </div>
              </div>

              {/* Resource–User Mapping Item */}
              <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                  <span>Step 2: Resource–User Mapping</span>
                  <span className="text-emerald-400 font-bold">✓ Verified</span>
                </div>
                <div className="text-sm font-mono font-bold text-white">
                  {successPopupData.remoteResourceId} ↔ {successPopupData.username}
                </div>
                <div className="text-emerald-300 font-mono text-[11px]">
                  Mapping Route: /addParentResourceUser
                </div>
              </div>

              {/* Step 3: eClaim Item */}
              {successPopupData.eclaimStatus && (
                <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                    <span>Step 3: eClaim User Link</span>
                    <span className="text-emerald-400 font-bold">✓ Verified</span>
                  </div>
                  <div className="text-sm font-mono font-bold text-white">
                    {successPopupData.eclaimName || successPopupData.username}
                  </div>
                  <div className="text-emerald-300 font-mono text-[11px]">
                    Endpoint: {successPopupData.eclaimLink || '/addUserEclaim'}
                  </div>
                </div>
              )}
            </div>

            {!successPopupData.eclaimStatus ? (
              <div className="p-2.5 bg-slate-950/60 border border-slate-800/80 rounded-lg text-[11px] text-slate-400 italic">
                Note: Sub-operations (eClaim and EMR forms) were strictly excluded from this action.
              </div>
            ) : (
              <div className="p-2.5 bg-slate-950/60 border border-slate-800/80 rounded-lg text-[11px] text-slate-400 italic">
                Note: EMR Form Assignment (Step 4) was safely preserved and excluded from this action.
              </div>
            )}

            <div className="pt-2 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setIsSuccessPopupOpen(false);
                  setSuccessPopupData(null);
                }}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all shadow-md shadow-emerald-950/40"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* EPHEMERAL CREDENTIAL DISPLAY MODAL */}
      <Modal
        isOpen={ephemeralCredModalOpen}
        onClose={() => setEphemeralCredModalOpen(false)}
        title="Ephemeral Credential Generated"
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 space-y-3">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400">Created Username</span>
              <div className="font-mono text-sm font-bold text-sky-400">{createdCredential?.username}</div>
            </div>

            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400">Ephemeral Password</span>
              <div className="flex items-center justify-between bg-slate-950 p-2 rounded-lg border border-slate-800 font-mono text-xs">
                <span className="text-emerald-400 font-bold">
                  {showPassword ? createdCredential?.password : '••••••••••••••••'}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="p-1 text-slate-400 hover:text-slate-200"
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (createdCredential?.password) {
                        navigator.clipboard.writeText(createdCredential.password);
                        setCopiedPassword(true);
                        setTimeout(() => setCopiedPassword(false), 2500);
                      }
                    }}
                    className="p-1 text-slate-400 hover:text-emerald-400"
                    title="Copy Password"
                  >
                    {copiedPassword ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            {createdCredential?.roles && createdCredential.roles.length > 0 && (
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400">Assigned Roles</span>
                <div className="text-xs text-slate-300 font-medium">
                  {createdCredential.roles.join(', ')}
                </div>
              </div>
            )}
          </div>

          <div className="p-2.5 bg-slate-900/40 rounded-lg border border-slate-800/60 text-[11px] text-slate-400 flex items-start gap-2">
            <Shield className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>
              This credential is held only in ephemeral memory and is never persisted to database tables, audit logs, or browser storage. Copy and provide it securely to the operator.
            </span>
          </div>

          <div className="flex justify-end pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setEphemeralCredModalOpen(false)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-xs transition-colors"
            >
              Acknowledge & Close
            </button>
          </div>
        </div>
      </Modal>

      {/* 6-STAGE FULL WORKFLOW COMPLETION SUCCESS MODAL */}
      <Modal
        isOpen={workflowSuccessModalOpen}
        onClose={() => setWorkflowSuccessModalOpen(false)}
        title="Full Integrated Workflow Verified"
        maxWidth="max-w-lg"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-emerald-950/40 border border-emerald-800/60 rounded-xl">
            <div className="w-10 h-10 rounded-full bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-emerald-200">All 6 Operations Verified Successfully!</h4>
              <p className="text-xs text-emerald-400/80">Every operation has been executed and remotely confirmed in Simplex.</p>
            </div>
          </div>

          <div className="p-4 bg-slate-900/70 rounded-xl border border-slate-800 space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">1. Resource Name</span>
                <span className="font-semibold text-slate-100 block">{workflowSuccessDetails?.resourceName}</span>
                <span className="text-[10px] font-mono text-emerald-400 block">Code: {workflowSuccessDetails?.resourceCode}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">2. Provisioned User</span>
                <span className="font-semibold text-slate-100 font-mono block">{workflowSuccessDetails?.username}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2.5 border-t border-slate-800">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">3. Assigned Roles</span>
                <span className="font-medium text-slate-200 block">{workflowSuccessDetails?.roles || 'None'}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">4. User-Resource Mapping</span>
                <span className="font-mono text-slate-200 block">{workflowSuccessDetails?.mappedResource}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2.5 border-t border-slate-800">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">5. eClaim Status</span>
                <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold mt-0.5">
                  <Check className="w-3.5 h-3.5" /> {workflowSuccessDetails?.eclaimStatus}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">6. Default Form Value</span>
                <span className="font-medium text-slate-200 block mt-0.5">{workflowSuccessDetails?.defaultFormValue}</span>
              </div>
            </div>

            <div className="pt-2.5 border-t border-slate-800 space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Target Branch</span>
              <span className="font-medium text-slate-200 block">{workflowSuccessDetails?.targetBranch}</span>
            </div>

            <div className="pt-2.5 border-t border-slate-800 space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Selected EMR Forms (Assigned & Transferred)</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {workflowSuccessDetails?.selectedEmrForms && workflowSuccessDetails.selectedEmrForms.length > 0 ? (
                  workflowSuccessDetails.selectedEmrForms.map((f, i) => (
                    <span key={i} className="px-2 py-0.5 rounded bg-sky-950/60 border border-sky-800/40 text-sky-300 font-mono text-[11px]">
                      {f}
                    </span>
                  ))
                ) : (
                  <span className="text-slate-500 italic">None selected</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => setWorkflowSuccessModalOpen(false)}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors shadow-md shadow-emerald-950/50"
            >
              Done
            </button>
          </div>
        </div>
      </Modal>

      {/* LINK USER MODAL */}
      <Modal
        isOpen={isLinkUserModalOpen}
        onClose={() => {
          setIsLinkUserModalOpen(false);
          setSelectedResourceForLink(null);
        }}
        title="Map Resource User (/addParentResourceUser)"
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

      {/* WORKBOOK IMPORT MODAL (Supports 6-Sheet Integrated & 10-Sheet Legacy) */}
      <Modal
        isOpen={isImportModalOpen}
        onClose={() => {
          setIsImportModalOpen(false);
          setImportFile(null);
          setPreviewData(null);
          setActiveJob(null);
        }}
        title="Resource & User Excel Import"
        maxWidth="max-w-3xl"
      >
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 p-3 bg-slate-900/60 rounded-lg border border-slate-800">
            <div className="text-xs text-slate-300">
              Download client-bound Excel template:
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleDownloadTemplate('1-SHEET')}
                className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 font-semibold px-2.5 py-1 bg-slate-800 rounded border border-sky-500/40 shadow-sm"
                title="Single unified data sheet with Step 1-5 color-coded sections and bold red required fields"
              >
                <Download className="w-3.5 h-3.5" />
                1-Sheet (Step-Wise Master)
              </button>
              <button
                type="button"
                onClick={() => handleDownloadTemplate('6-SHEET')}
                className="text-xs text-slate-400 hover:text-slate-300 flex items-center gap-1 font-medium px-2 py-1 bg-slate-800/60 rounded border border-slate-700/60"
                title="Multi-tab workbook with 5 separate relational sheets"
              >
                <Download className="w-3.5 h-3.5" />
                6-Sheet (Tabbed)
              </button>
            </div>

          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
              Select Excel Workbook (.xlsx)
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
              <span>Parsing and validating workbook sheets…</span>
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
                  <div key={r.rowNumber} className="py-2 flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-slate-300">#{r.rowNumber}</span>
                        <strong className="text-slate-100">{r.resourceName}</strong>
                        <span className="text-slate-400 text-xs">({r.isResourceHuman ? 'Human' : 'Non-Human'})</span>
                        {r.username && (
                          <span className="px-1.5 py-0.5 bg-slate-800 text-sky-400 rounded text-[11px] font-mono">
                            @{r.username}
                          </span>
                        )}
                        {r.roles && (
                          <span className="px-1.5 py-0.5 bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 rounded text-[11px]">
                            {r.roles}
                          </span>
                        )}
                        {r.emrForms && (
                          <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 rounded text-[11px]">
                            EMR: {r.emrForms}
                          </span>
                        )}
                        {r.eclaimInfo && (
                          <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-300 border border-amber-500/20 rounded text-[11px]">
                            eClaim: {r.eclaimInfo}
                          </span>
                        )}
                      </div>
                      {r.errors?.length > 0 && (
                        <div className="text-rose-400 text-[11px] mt-1">{r.errors.join('; ')}</div>
                      )}
                    </div>
                    <span
                      className={`font-semibold text-xs px-2 py-0.5 rounded whitespace-nowrap ${
                        r.isValid ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
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
