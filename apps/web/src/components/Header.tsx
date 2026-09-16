import React from 'react';
import { LogOut, UserCircle, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';

export const Header: React.FC = () => {
  const { user, logout } = useAuth();

  return (
    <header className="h-16 bg-surface border-b border-surface-border flex items-center justify-between px-8">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-slate-100">SIMPLEX Central Operations Console</h1>
      </div>

      <div className="flex items-center gap-4">
        {user && (
          <div className="flex items-center gap-3 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800">
            <UserCircle className="w-5 h-5 text-sky-400" />
            <div className="text-left">
              <div className="text-xs font-medium text-slate-200">{user.fullName}</div>
              <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                <Shield className="w-2.5 h-2.5 text-sky-400" />
                {user.roles.map((r) => r.name).join(', ')}
              </div>
            </div>
          </div>
        )}

        <button
          onClick={logout}
          title="Sign Out"
          className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800/80 rounded-lg transition-colors"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
};
