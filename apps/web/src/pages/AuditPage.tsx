import React, { useEffect, useState } from 'react';
import { History, Download, Search, Filter, ShieldCheck, ShieldAlert, Clock, User } from 'lucide-react';
import { ApiClient } from '../api/client.js';
import { AuditLogEntry, AuditResult } from '@hmc/shared';

export const AuditPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [resultFilter, setResultFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);

  const loadLogs = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (actionFilter) params.append('action', actionFilter);
      if (userFilter) params.append('actorUsername', userFilter);
      if (resultFilter !== 'ALL') params.append('result', resultFilter);
      params.append('limit', '100');

      const res = await ApiClient.request<{ logs: AuditLogEntry[]; total: number }>(`/audit?${params.toString()}`);
      setLogs(res.logs || []);
      setTotal(res.total || 0);
    } catch (err) {
      console.error('Failed to load audit logs', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [resultFilter]);

  const handleExportCsv = async () => {
    try {
      const blob = await ApiClient.request<Blob>('/audit/export');
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-export-${Date.now()}.csv`;
      a.click();
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">System Audit & Security Logs</h2>
          <p className="text-xs text-slate-400">
            Immutable structured operational logs with correlation tracking and sanitized details
          </p>
        </div>

        <button
          onClick={handleExportCsv}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold shadow-sm transition-colors"
        >
          <Download className="w-4 h-4" />
          Export Audit Trail (CSV)
        </button>
      </div>

      {/* Filters */}
      <div className="bg-surface p-4 rounded-xl border border-surface-border grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Filter by Action..."
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadLogs()}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>

        <div className="relative">
          <User className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Filter by Username..."
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadLogs()}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>

        <div>
          <select
            value={resultFilter}
            onChange={(e) => setResultFilter(e.target.value)}
            className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100"
          >
            <option value="ALL">All Outcomes</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="FAILURE">FAILURE</option>
            <option value="DENIED">DENIED</option>
            <option value="SECURITY_BLOCK">SECURITY_BLOCK</option>
          </select>
        </div>

        <div>
          <button
            onClick={loadLogs}
            className="w-full py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            Apply Filters
          </button>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-surface border border-surface-border rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-900/90 border-b border-surface-border text-slate-400 uppercase font-semibold text-[11px]">
              <th className="py-3 px-4">Timestamp (UTC)</th>
              <th className="py-3 px-4">Actor</th>
              <th className="py-3 px-4">Action</th>
              <th className="py-3 px-4">Target Client</th>
              <th className="py-3 px-4">Result</th>
              <th className="py-3 px-4">Correlation ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border font-mono text-[11px]">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-500 font-sans">Loading audit records...</td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-500 font-sans">No audit events found.</td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-900/40 transition-colors">
                  <td className="py-2.5 px-4 text-slate-300">
                    {new Date(log.timestamp).toISOString().replace('T', ' ').substring(0, 19)}
                  </td>
                  <td className="py-2.5 px-4 text-sky-400 font-bold">{log.actorUsername || 'SYSTEM'}</td>
                  <td className="py-2.5 px-4 text-white font-semibold">{log.action}</td>
                  <td className="py-2.5 px-4 text-slate-400">{log.clientCode || '-'}</td>
                  <td className="py-2.5 px-4 font-sans">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        log.result === 'SUCCESS'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : log.result === 'FAILURE'
                          ? 'bg-red-950 text-red-400 border border-red-800'
                          : log.result === 'DENIED'
                          ? 'bg-amber-950 text-amber-400 border border-amber-800'
                          : 'bg-purple-950 text-purple-400 border border-purple-800'
                      }`}
                    >
                      {log.result}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-slate-500 text-[10px]">{log.correlationId || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
