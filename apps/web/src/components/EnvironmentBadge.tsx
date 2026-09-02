import React from 'react';
import { ClientEnvironment } from '@hmc/shared';
import { AlertTriangle, ShieldCheck, Wrench, TestTube } from 'lucide-react';

export const EnvironmentBadge: React.FC<{ environment: ClientEnvironment; showIcon?: boolean }> = ({
  environment,
  showIcon = true,
}) => {
  switch (environment) {
    case 'Production':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-950/80 text-red-400 border border-red-800 shadow-sm animate-pulse">
          {showIcon && <AlertTriangle className="w-3 h-3 text-red-400" />}
          PRODUCTION
        </span>
      );
    case 'UAT':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-950/80 text-amber-300 border border-amber-800">
          {showIcon && <ShieldCheck className="w-3 h-3 text-amber-300" />}
          UAT
        </span>
      );
    case 'Test':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-950/80 text-blue-300 border border-blue-800">
          {showIcon && <TestTube className="w-3 h-3 text-blue-300" />}
          TEST
        </span>
      );
    case 'Development':
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
          {showIcon && <Wrench className="w-3 h-3 text-slate-400" />}
          DEVELOPMENT
        </span>
      );
  }
};
