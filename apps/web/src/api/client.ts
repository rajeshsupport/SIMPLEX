import type { EmrFormsQueryResult, ClientUser } from '@hmc/shared';

const API_BASE = '/api/v1';

export class ApiClient {
  public static getAccessToken(): string | null {
    return localStorage.getItem('hmc_access_token');
  }

  public static getBaseUrl(): string {
    return API_BASE;
  }

  private static getRefreshToken(): string | null {
    return localStorage.getItem('hmc_refresh_token');
  }

  public static setTokens(access: string, refresh: string) {
    localStorage.setItem('hmc_access_token', access);
    localStorage.setItem('hmc_refresh_token', refresh);
  }

  public static clearTokens() {
    localStorage.removeItem('hmc_access_token');
    localStorage.removeItem('hmc_refresh_token');
    localStorage.removeItem('hmc_user');
  }

  public static async request<T = any>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = this.getAccessToken();
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    let res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    // If 401, attempt refresh token rotation
    if (res.status === 401 && this.getRefreshToken()) {
      const refreshToken = this.getRefreshToken();
      try {
        const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });

        if (refreshRes.ok) {
          const data = await refreshRes.json();
          this.setTokens(data.accessToken, data.refreshToken);
          headers['Authorization'] = `Bearer ${data.accessToken}`;

          res = await fetch(`${API_BASE}${path}`, {
            ...options,
            headers,
          });
        } else {
          this.clearTokens();
          throw new Error('SESSION_EXPIRED — Please sign in again.');
        }
      } catch (err: any) {
        this.clearTokens();
        throw new Error('SESSION_EXPIRED — Please sign in again.');
      }
    }

    if (res.status === 401) {
      this.clearTokens();
      throw new Error('SESSION_EXPIRED — Please sign in again.');
    }

    if (!res.ok) {
      let errBody: any;
      try {
        errBody = await res.json();
      } catch {
        errBody = { message: res.statusText };
      }
      throw new Error(errBody.message || errBody.error || `HTTP error ${res.status}`);
    }

    // Handle CSV, Excel, or file blob responses
    const contentType = res.headers.get('content-type');
    if (
      contentType &&
      (contentType.includes('text/csv') ||
        contentType.includes('application/octet-stream') ||
        contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') ||
        contentType.includes('application/vnd.ms-excel'))
    ) {
      return (await res.blob()) as unknown as T;
    }

    return res.json();
  }

  public static async downloadBlob(
    path: string,
    options: RequestInit = {}
  ): Promise<{ blob: Blob; filename?: string }> {
    const token = this.getAccessToken();
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    // If 401, attempt refresh token rotation
    if (res.status === 401 && this.getRefreshToken()) {
      const refreshToken = this.getRefreshToken();
      try {
        const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });

        if (refreshRes.ok) {
          const data = await refreshRes.json();
          this.setTokens(data.accessToken, data.refreshToken);
          headers['Authorization'] = `Bearer ${data.accessToken}`;

          res = await fetch(`${API_BASE}${path}`, {
            ...options,
            headers,
          });
        } else {
          this.clearTokens();
          throw new Error('SESSION_EXPIRED — Please sign in again.');
        }
      } catch (err: any) {
        this.clearTokens();
        throw new Error('SESSION_EXPIRED — Please sign in again.');
      }
    }

    if (res.status === 401) {
      this.clearTokens();
      throw new Error('SESSION_EXPIRED — Please sign in again.');
    }

    if (!res.ok) {
      let errBody: any;
      try {
        errBody = await res.json();
      } catch {
        errBody = { message: res.statusText };
      }
      throw new Error(errBody.message || errBody.error || `HTTP error ${res.status}`);
    }

    const disposition = res.headers.get('content-disposition');
    let filename: string | undefined = undefined;
    if (disposition && disposition.includes('filename=')) {
      const match = disposition.match(/filename="?([^";]+)"?/);
      if (match && match[1]) {
        filename = match[1];
      }
    }

    const blob = await res.blob();
    return { blob, filename };
  }
}

export const clientResourcesApi = {
  getResources: (params: {
    clientId: string;
    branchName?: string;
    search?: string;
    specialty?: string;
    resourceType?: string;
    status?: string;
    isResourceHuman?: boolean | string;
    page?: number;
    limit?: number;
  }) => {
    const q = new URLSearchParams();
    q.set('clientId', params.clientId);
    if (params.branchName) q.set('branchName', params.branchName);
    if (params.search) q.set('search', params.search);
    if (params.specialty) q.set('specialty', params.specialty);
    if (params.resourceType) q.set('resourceType', params.resourceType);
    if (params.status) q.set('status', params.status);
    if (params.isResourceHuman !== undefined) q.set('isResourceHuman', String(params.isResourceHuman));
    if (params.page) q.set('page', String(params.page));
    if (params.limit) q.set('limit', String(params.limit));
    return ApiClient.request<{ data: any[]; total: number; page: number; limit: number; summary?: any }>(`/client-resources?${q.toString()}`);
  },

  syncResources: (clientId: string, targetBranch?: string, signal?: AbortSignal) =>
    ApiClient.request<{
      success: boolean;
      message: string;
      count?: number;
      totalScraped?: number;
      createdCount?: number;
      updatedCount?: number;
      humanCount?: number;
      nonHumanCount?: number;
      totalInScope?: number;
      totalInDatabase?: number;
    }>('/client-resources/sync', {
      method: 'POST',
      body: JSON.stringify({ clientId, targetBranch }),
      signal,
    }),

  createResource: (payload: any) =>
    ApiClient.request<{ success: boolean; message: string; resource: any }>('/client-resources/create', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  setResourceStatus: (payload: { clientId: string; remoteResourceId: string; status: string; reason?: string }) =>
    ApiClient.request<{ success: boolean; message: string }>('/client-resources/status', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  mapResourceUser: (payload: { clientId: string; remoteResourceId: string; username: string; resourceName?: string }) =>
    ApiClient.request<{
      success?: boolean;
      operationStatus?: string;
      runId?: string;
      stage?: string;
      message?: string;
      alreadyExists?: boolean;
      remoteResourceId?: string;
      username?: string;
    }>('/client-resources/map-user', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  importPreview: (clientId: string, file: File) => {
    const formData = new FormData();
    formData.append('clientId', clientId);
    formData.append('file', file);
    return ApiClient.request<any>('/client-resources/import-preview', {
      method: 'POST',
      body: formData,
    });
  },

  importExecute: (jobId: string) =>
    ApiClient.request<any>('/client-resources/import-execute', {
      method: 'POST',
      body: JSON.stringify({ jobId }),
    }),

  getImportJob: (jobId: string) =>
    ApiClient.request<any>(`/client-resources/import-jobs/${jobId}`),

  retryImportJob: (jobId: string) =>
    ApiClient.request<any>(`/client-resources/import-jobs/${jobId}/retry`, {
      method: 'POST',
    }),

  exportJobResults: (jobId: string) =>
    ApiClient.downloadBlob(`/client-resources/import-jobs/${jobId}/export-results`),

  downloadTemplate: (clientId?: string, clientCode?: string, format: '1-SHEET' | '6-SHEET' | '10-SHEET' = '1-SHEET') => {
    const q = new URLSearchParams();
    if (clientId) q.set('clientId', clientId);
    if (clientCode) q.set('clientCode', clientCode);
    if (format) q.set('format', format);
    return ApiClient.downloadBlob(`/client-resources/template?${q.toString()}`);
  },


  exportResources: (clientId: string, mode: 'ALL' | 'ACTIVE_ONLY' | 'INACTIVE_ONLY' = 'ALL') =>
    ApiClient.downloadBlob(`/client-resources/export?clientId=${encodeURIComponent(clientId)}&mode=${encodeURIComponent(mode)}`),

  getResourceTypes: (clientId: string, isResourceHuman?: boolean | string) => {
    const q = new URLSearchParams({ clientId });
    if (isResourceHuman !== undefined && isResourceHuman !== 'ALL') {
      q.set('isResourceHuman', String(isResourceHuman));
    }
    return ApiClient.request<string[]>(`/client-resources/resource-types?${q.toString()}`);
  },

  getSpecialties: (clientId: string) =>
    ApiClient.request<string[]>(`/client-resources/specialties?clientId=${encodeURIComponent(clientId)}`),

  getDepartments: (clientId: string) =>
    ApiClient.request<any[]>(`/client-resources/departments?clientId=${encodeURIComponent(clientId)}`),

  getServices: (clientId: string) =>
    ApiClient.request<any[]>(`/client-resources/services?clientId=${encodeURIComponent(clientId)}`),

  getEmrForms: (clientId: string, username?: string) =>
    ApiClient.request<EmrFormsQueryResult>(
      `/client-resources/emr-forms?clientId=${encodeURIComponent(clientId)}${username ? `&username=${encodeURIComponent(username)}` : ''}`
    ),

  getEclaimOptions: (clientId: string) =>
    ApiClient.request<{ supported: boolean; roles: string[]; facilities?: string[]; endpoint?: string }>(
      `/client-resources/eclaim-options?clientId=${encodeURIComponent(clientId)}`
    ),

  createIntegratedResource: (payload: any) =>
    ApiClient.request<{
      success: boolean;
      message: string;
      stage: string;
      resource?: any;
      createdUserCredentials?: { username: string; password?: string; roles?: string[] };
      stepOutcomes?: Array<{
        operation: string;
        name: string;
        route: string;
        status: string;
        remoteId?: string;
        details?: string;
        verifiedAt?: string;
        errorCode?: string;
        errorMessage?: string;
      }>;
    }>('/client-resources/create-integrated', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  resumeIntegratedProvisioning: (payload: any) =>
    ApiClient.request<{
      success: boolean;
      status?: string;
      message: string;
      stage: string;
      runId?: string;
      resource?: any;
      stepOutcomes?: Array<{
        operation: string;
        name: string;
        route: string;
        status: string;
        remoteId?: string;
        details?: string;
        verifiedAt?: string;
        errorCode?: string;
        errorMessage?: string;
      }>;
    }>('/client-resources/resume-integrated', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getProvisioningRunStatus: (runId: string) =>
    ApiClient.request<{
      runId: string;
      status: string;
      stage: string;
      stepOutcomes: Array<any>;
      remoteResourceId?: string;
      remoteUserId?: string;
      eclaimStatus?: string;
      assignedForms?: string[];
      createdUserCredentials?: any;
      resource?: any;
      errorMessage?: string;
      errorCode?: string;
      completed: boolean;
      failed: boolean;
      inProgress: boolean;
    }>(`/client-resources/runs/${runId}/status`),

  createResourceOnly: (payload: {
    clientId: string;
    resourceName: string;
    isResourceHuman?: boolean;
    resourceType: string;
    specialty: string;
    departments?: string;
    colorIdentificationCode?: string;
    services?: string;
    operatingFrom?: string;
    operatingTo?: string;
    branchId?: string;
    allowReuseIfExisting?: boolean;
    reconcileOnly?: boolean;
  }) =>
    ApiClient.request<{
      operationStatus?: string;
      runId?: string;
      stage?: string;
      message?: string;
      resource?: any;
      remoteResourceId?: string;
      alreadyExists?: boolean;
      reused?: boolean;
    }>('/client-resources/create', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

export const clientUsersApi = {
  mapBillCounterUser: (id: string, payload?: { targetBranch?: string; roleName?: string }) =>
    ApiClient.request<{
      success: boolean;
      alreadyExists?: boolean;
      username?: string;
      billCounterName?: string;
      roleName?: string;
      message: string;
    }>(`/client-users/${id}/map-bill-counter`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),

  getStockLocationUrls: (clientId: string) =>
    ApiClient.request<{
      clientId: string;
      clientCode: string;
      clientName: string;
      baseUrl: string;
      applicationPath?: string;
      stockLocationListUrl: string;
      addStockLocationUrl: string;
    }>(`/client-users/stock-location-urls?clientId=${encodeURIComponent(clientId)}`),

  getStockLocationMappings: (clientId: string) =>
    ApiClient.request<{
      mappings: Array<{
        id: string;
        clientId: string;
        stockLocationName: string;
        userName: string;
        username?: string;
        status: string;
        lastSyncedAt: string;
      }>;
      count: number;
      lastSyncedAt: string | null;
    }>(`/client-users/stock-location-mappings?clientId=${encodeURIComponent(clientId)}`),

  refreshStockLocationMappings: (clientId: string, targetBranch?: string) =>
    ApiClient.request<{
      success: boolean;
      count: number;
      matchedUsersCount: number;
      message: string;
    }>(`/client-users/stock-location-mappings/refresh?clientId=${encodeURIComponent(clientId)}`, {
      method: 'POST',
      body: JSON.stringify({ targetBranch }),
    }),

  mapStockLocationUser: (id: string, payload?: {
    targetBranch?: string;
    stockLocationNames?: string[];
    stockLocationIds?: string[];
  }) =>
    ApiClient.request<{
      success: boolean;
      alreadyExists?: boolean;
      username?: string;
      mappedLocations?: string[];
      message: string;
    }>(`/client-users/${id}/map-stock-location`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),

  openStockLocationSession: (id: string, payload?: { targetBranch?: string }) =>
    ApiClient.request<{
      id: string;
      status: string;
      runType: string;
    }>(`/client-users/${id}/open-stock-location-session`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),


  getDocumentTypes: (clientId: string) =>
    ApiClient.request<{
      documentTypes: Array<{
        docTypeId: string;
        docTypeName: string;
        userDocGroup?: string;
        groupCode?: string;
        mappedUsersCount: number;
        totalUsersCount?: number;
        mappedUsernames: string[];
        mappedUserFullNames?: string[];
        lastSyncedAt?: string;
      }>;
      totalDocumentTypes: number;
      totalMappings: number;
      allUsers: Array<{
        username: string;
        fullName: string;
        isDocumentTypeMapped: boolean;
        documentTypeNames?: string | null;
      }>;
    }>(`/client-users/document-types?clientId=${encodeURIComponent(clientId)}`),

  refreshDocumentTypeMappings: (clientId: string, targetBranch?: string) =>
    ApiClient.request<{
      success: boolean;
      count: number;
      matchedUsersCount: number;
      documentTypesCount: number;
      message: string;
    }>(`/client-users/document-type-mappings/refresh?clientId=${encodeURIComponent(clientId)}`, {
      method: 'POST',
      body: JSON.stringify({ targetBranch }),
    }),

  updateDocumentTypeMappings: (
    clientId: string,
    docTypeId: string,
    payload: { selectedUsernames: string[]; targetBranch?: string; userDocGroup?: string }
  ) =>
    ApiClient.request<{
      success: boolean;
      docTypeId: string;
      docTypeName?: string;
      selectedUsernames: string[];
      message: string;
    }>(`/client-users/document-types/${encodeURIComponent(docTypeId)}/update-mappings?clientId=${encodeURIComponent(clientId)}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  openDocumentTypeSession: (payload: {
    clientId: string;
    docTypeId?: string;
    username?: string;
    targetBranch?: string;
  }) =>
    ApiClient.request<{
      id: string;
      status: string;
      runType: string;
    }>(`/client-users/open-document-type-session?clientId=${encodeURIComponent(payload.clientId)}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),


  getFormAssemblyForms: (clientId: string, userId?: string) =>
    ApiClient.request<{
      forms: Array<{
        formId: string;
        formName: string;
        groupName?: string;
        isDefault?: boolean;
        isMapped?: boolean;
        assignedUsersCount?: number;
        assignedUsernames?: string[];
      }>;
      totalForms: number;
      userMappedCount: number;
      userMappedForms: string[];
      user?: {
        id: string;
        username: string;
        fullName: string;
        isFormAssemblyMapped: boolean;
        formAssemblyNames?: string | null;
      };
    }>(`/client-users/form-assembly?clientId=${encodeURIComponent(clientId)}${userId ? `&userId=${encodeURIComponent(userId)}` : ''}`),

  refreshFormAssemblyMappings: (clientId: string, targetBranch?: string) =>
    ApiClient.request<{
      success: boolean;
      count: number;
      matchedUsersCount: number;
      formsCount: number;
      message: string;
    }>(`/client-users/form-assembly/refresh`, {
      method: 'POST',
      body: JSON.stringify({ clientId, targetBranch }),
    }),

  updateFormAssemblyMappings: (
    userId: string,
    payload: { clientId: string; formIds: string[]; targetBranch?: string }
  ) =>
    ApiClient.request<{
      success: boolean;
      assignedFormIds: string[];
      assignedFormNames: string[];
      user: ClientUser;
      message: string;
    }>(`/client-users/${encodeURIComponent(userId)}/update-form-assembly`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  openFormAssemblySession: (
    userId: string,
    payload: { clientId: string; targetBranch?: string }
  ) =>
    ApiClient.request<{
      success: boolean;
      message: string;
      targetUrl?: string;
    }>(`/client-users/${encodeURIComponent(userId)}/open-form-assembly-session`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  mapUserRoles: (payload: {
    clientId: string;
    username: string;
    roles: string[];
    fullName?: string;
    firstName?: string;
    remoteUserId?: string;
    allowDeactivation?: boolean;
  }) =>
    ApiClient.request<{
      success: boolean;
      username: string;
      errorCode?: string;
      errorMessage?: string;
      roleVerificationState?: string;
      mappedRoles?: string[];
    }>('/client-users/map-roles', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

