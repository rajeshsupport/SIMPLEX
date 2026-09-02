import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { Sidebar } from './components/Sidebar.js';
import { Header } from './components/Header.js';

import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { ClientsPage } from './pages/ClientsPage.js';
import { ImportsPage } from './pages/ImportsPage.js';
import { UsersPage } from './pages/UsersPage.js';
import { RolesPage } from './pages/RolesPage.js';
import { AuditPage } from './pages/AuditPage.js';
import { AgentsPage } from './pages/AgentsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';

const ProtectedLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-slate-400 text-xs">
        Loading HMC Console Session...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-8">{children}</main>
      </div>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedLayout>
                <DashboardPage />
              </ProtectedLayout>
            }
          />
          <Route
            path="/clients"
            element={
              <ProtectedLayout>
                <ClientsPage />
              </ProtectedLayout>
            }
          />
          <Route
            path="/imports"
            element={
              <ProtectedLayout>
                <ImportsPage />
              </ProtectedLayout>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedLayout>
                <UsersPage />
              </ProtectedLayout>
            }
          />
          <Route
            path="/roles"
            element={
              <ProtectedLayout>
                <RolesPage />
              </ProtectedLayout>
            }
          />
          <Route
            path="/agents"
            element={
              <ProtectedLayout>
                <AgentsPage />
              </ProtectedLayout>
            }
          />
          <Route
            path="/audit"
            element={
              <ProtectedLayout>
                <AuditPage />
              </ProtectedLayout>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedLayout>
                <SettingsPage />
              </ProtectedLayout>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
};
