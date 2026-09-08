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
      const err = new Error(errBody.message || errBody.error || `HTTP error ${res.status}`) as any;
      err.code = errBody.code;
      err.status = res.status;
      err.response = errBody;
      throw err;
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
    if (params.search) q.set('search', params.search);
    if (params.specialty) q.set('specialty', params.specialty);
    if (params.resourceType) q.set('resourceType', params.resourceType);
    if (params.status) q.set('status', params.status);
    if (params.isResourceHuman !== undefined) q.set('isResourceHuman', String(params.isResourceHuman));
    if (params.page) q.set('page', String(params.page));
    if (params.limit) q.set('limit', String(params.limit));
    return ApiClient.request<{ data: any[]; total: number; page: number; limit: number }>(`/client-resources?${q.toString()}`);
  },

  syncResources: (clientId: string) =>
    ApiClient.request<{ success: boolean; message: string; count?: number }>('/client-resources/sync', {
      method: 'POST',
      body: JSON.stringify({ clientId }),
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

  mapResourceUser: (payload: { clientId: string; remoteResourceId: string; username: string }) =>
    ApiClient.request<{ success: boolean; message: string }>('/client-resources/map-user', {
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

  downloadTemplate: (clientId?: string, clientCode?: string) => {
    const q = new URLSearchParams();
    if (clientId) q.set('clientId', clientId);
    if (clientCode) q.set('clientCode', clientCode);
    return ApiClient.downloadBlob(`/client-resources/template?${q.toString()}`);
  },

  exportResources: (clientId: string, mode: 'ALL' | 'ACTIVE_ONLY' = 'ALL') =>
    ApiClient.downloadBlob(`/client-resources/export?clientId=${encodeURIComponent(clientId)}&mode=${encodeURIComponent(mode)}`),

  getResourceTypes: (clientId: string) =>
    ApiClient.request<string[]>(`/client-resources/resource-types?clientId=${encodeURIComponent(clientId)}`),

  getSpecialties: (clientId: string) =>
    ApiClient.request<string[]>(`/client-resources/specialties?clientId=${encodeURIComponent(clientId)}`),

  getDepartments: (clientId: string) =>
    ApiClient.request<any[]>(`/client-resources/departments?clientId=${encodeURIComponent(clientId)}`),

  getServices: (clientId: string) =>
    ApiClient.request<any[]>(`/client-resources/services?clientId=${encodeURIComponent(clientId)}`),
};
