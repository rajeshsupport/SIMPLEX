const API_BASE = '/api/v1';

export class ApiClient {
  private static getAccessToken(): string | null {
    return localStorage.getItem('hmc_access_token');
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
          window.location.href = '/login';
          throw new Error('Session expired');
        }
      } catch {
        this.clearTokens();
        window.location.href = '/login';
        throw new Error('Session expired');
      }
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

    // Handle CSV or file blob responses
    const contentType = res.headers.get('content-type');
    if (contentType && (contentType.includes('text/csv') || contentType.includes('application/octet-stream'))) {
      return (await res.blob()) as unknown as T;
    }

    return res.json();
  }
}
