import React, { createContext, useContext, useState, useEffect } from 'react';
import { ApiClient } from '../api/client.js';
import { UserSummary, PermissionCode, SYSTEM_ROLES } from '@hmc/shared';

interface AuthContextType {
  user: UserSummary | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  hasPermission: (permission: PermissionCode) => boolean;
  isSuperAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserSummary | null>(() => {
    const saved = localStorage.getItem('hmc_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function verifyAuth() {
      const token = localStorage.getItem('hmc_access_token');
      if (token) {
        try {
          const res = await ApiClient.request<{ user: any }>('/auth/me');
          // Fetch full user summary
          const fullUser = await ApiClient.request<UserSummary>(`/users/${res.user.sub}`);
          setUser(fullUser);
          localStorage.setItem('hmc_user', JSON.stringify(fullUser));
        } catch {
          ApiClient.clearTokens();
          setUser(null);
        }
      }
      setIsLoading(false);
    }
    verifyAuth();
  }, []);

  const login = async (username: string, password: string) => {
    const data = await ApiClient.request<{ tokens: { accessToken: string; refreshToken: string }; user: UserSummary }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    ApiClient.setTokens(data.tokens.accessToken, data.tokens.refreshToken);
    setUser(data.user);
    localStorage.setItem('hmc_user', JSON.stringify(data.user));
  };

  const logout = () => {
    ApiClient.request('/auth/logout', { method: 'POST' }).catch(() => {});
    ApiClient.clearTokens();
    setUser(null);
    window.location.href = '/login';
  };

  const isSuperAdmin = Boolean(
    user?.roles?.some((r) => r.name === SYSTEM_ROLES.SUPER_ADMIN)
  );

  const hasPermission = (permission: PermissionCode): boolean => {
    if (!user) return false;
    if (isSuperAdmin) return true;

    return user.roles.some((r) =>
      r.permissions?.includes(permission)
    );
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        logout,
        hasPermission,
        isSuperAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
