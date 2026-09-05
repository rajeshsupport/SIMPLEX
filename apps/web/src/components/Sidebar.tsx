import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Server,
  FileSpreadsheet,
  Users,
  Layers,
  Shield,
  History,
  Laptop,
  Settings,
  Activity,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { PERMISSIONS } from '@hmc/shared';

export const Sidebar: React.FC = () => {
  const { hasPermission } = useAuth();

  const navItems = [
    {
      label: 'Dashboard',
      path: '/',
      icon: LayoutDashboard,
      visible: hasPermission(PERMISSIONS.DASHBOARD_VIEW),
    },
    {
      label: 'Client Portals',
      path: '/clients',
      icon: Server,
      visible: hasPermission(PERMISSIONS.CLIENT_VIEW),
    },
    {
      label: 'Import Operations',
      path: '/imports',
      icon: FileSpreadsheet,
      visible: hasPermission(PERMISSIONS.IMPORT_PREVIEW) || hasPermission(PERMISSIONS.SERVICE_MASTER_IMPORT),
    },
    {
      label: 'Users',
      path: '/users',
      icon: Users,
      visible:
        hasPermission(PERMISSIONS.CLIENT_USERS_VIEW) ||
        hasPermission(PERMISSIONS.USER_MANAGEMENT_VIEW) ||
        hasPermission(PERMISSIONS.APPLICATION_USER_MANAGE),
    },
    {
      label: 'Resource Master',
      path: '/resources',
      icon: Layers,
      visible: hasPermission(PERMISSIONS.CLIENT_RESOURCES_VIEW),
    },
    {
      label: 'Roles & RBAC',
      path: '/roles',
      icon: Shield,
      visible: hasPermission(PERMISSIONS.ROLE_VIEW),
    },
    {
      label: 'Desktop Agents',
      path: '/agents',
      icon: Laptop,
      visible: hasPermission(PERMISSIONS.AGENT_VIEW),
    },
    {
      label: 'Audit & Error Logs',
      path: '/audit',
      icon: History,
      visible: hasPermission(PERMISSIONS.AUDIT_VIEW),
    },
    {
      label: 'Settings & Retention',
      path: '/settings',
      icon: Settings,
      visible: hasPermission(PERMISSIONS.AUDIT_VIEW),
    },
  ];

  return (
    <aside className="w-64 bg-surface border-r border-surface-border flex flex-col h-screen select-none">
      {/* Brand */}
      <div className="h-16 flex items-center px-6 border-b border-surface-border gap-3">
        <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center shadow-lg shadow-sky-900/50">
          <Activity className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="font-bold text-sm tracking-wide text-white">HMC CONSOLE</div>
          <div className="text-[10px] uppercase font-mono text-sky-400 tracking-wider">Central Automation</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="text-[11px] font-semibold text-slate-500 uppercase px-3 mb-2 tracking-wider">
          Operations & Control
        </div>
        {navItems
          .filter((item) => item.visible)
          .map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-sky-600/20 text-sky-400 border border-sky-500/30'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
      </nav>

      {/* System Status Footer */}
      <div className="p-4 border-t border-surface-border bg-slate-950/40">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Central Gateway Online</span>
        </div>
        <div className="text-[10px] text-slate-500 mt-1 font-mono">MSSQL 2022 • Isolated Workflows</div>
      </div>
    </aside>
  );
};
