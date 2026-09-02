import React, { useEffect, useState } from 'react';
import { Settings, Shield, Trash2, Clock, CheckCircle2 } from 'lucide-react';
import { ApiClient } from '../api/client.js';
import { RetentionPolicyConfig } from '@hmc/shared';

export const SettingsPage: React.FC = () => {
  const [policies, setPolicies] = useState<RetentionPolicyConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [purgeResult, setPurgeResult] = useState<string | null>(null);

  const loadPolicies = async () => {
    try {
      setLoading(true);
      const data = await ApiClient.request<RetentionPolicyConfig[]>('/retention/policies');
      setPolicies(data || []);
    } catch (err) {
      console.error('Failed to load retention policies', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPolicies();
  }, []);

  const handleExecutePurge = async () => {
    if (!confirm('Execute retention purge according to configured policies? Old records will be archived/purged.')) return;
    try {
      const res = await ApiClient.request<{ purgedCounts: Record<string, number> }>('/retention/purge', {
        method: 'POST',
      });
      setPurgeResult(`Purge completed: ${JSON.stringify(res.purgedCounts)}`);
      await loadPolicies();
    } catch (err: any) {
      alert(`Purge failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">System Settings & Data Retention</h2>
        <p className="text-xs text-slate-400">
          Configure operational data lifecycle, archiving destinations, and system guardrails
        </p>
      </div>

      {purgeResult && (
        <div className="p-3.5 bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs rounded-lg flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          {purgeResult}
        </div>
      )}

      {/* Retention Policies Table */}
      <div className="bg-surface border border-surface-border rounded-xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Clock className="w-4 h-4 text-sky-400" />
            Configured Retention Policies
          </h3>

          <button
            onClick={handleExecutePurge}
            className="flex items-center gap-2 px-3 py-1.5 bg-red-900/60 hover:bg-red-800 text-red-200 border border-red-700 rounded-lg text-xs font-semibold transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Execute Retention Purge
          </button>
        </div>

        <div className="border border-surface-border rounded-lg overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-900 text-slate-400 uppercase font-semibold">
                <th className="py-2.5 px-4">Log / Artifact Type</th>
                <th className="py-2.5 px-4">Retention Window</th>
                <th className="py-2.5 px-4">Archive Status</th>
                <th className="py-2.5 px-4">Last Purged</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border font-mono text-[11px]">
              {policies.map((pol) => (
                <tr key={pol.id}>
                  <td className="py-3 px-4 font-bold text-white font-sans">{pol.logType}</td>
                  <td className="py-3 px-4 text-sky-400">{pol.retentionDays} Days</td>
                  <td className="py-3 px-4 font-sans">
                    {pol.isArchiveEnabled ? (
                      <span className="text-emerald-400 font-semibold">Archive to {pol.archiveDestination || 'Storage'}</span>
                    ) : (
                      <span className="text-slate-500">Purge Directly</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-slate-400">
                    {pol.lastPurgedAt ? new Date(pol.lastPurgedAt).toLocaleString() : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Security Architecture Summary Card */}
      <div className="bg-surface border border-surface-border rounded-xl p-6 shadow-sm space-y-3">
        <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-400" />
          Security Architecture Controls
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800">
            <div className="font-semibold text-slate-200 mb-1">Argon2id Hashing</div>
            <div className="text-slate-400 text-[11px]">
              High memory & time cost hashing for console users. Never stores plaintext passwords.
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800">
            <div className="font-semibold text-slate-200 mb-1">AES-256-GCM Envelope Encryption</div>
            <div className="text-slate-400 text-[11px]">
              Client operator credentials encrypted with master secret. Credential values masked in UI.
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800">
            <div className="font-semibold text-slate-200 mb-1">Browser Profile Isolation</div>
            <div className="text-slate-400 text-[11px]">
              Strict separate Chromium profile per client and user to avoid session & cookie pollution.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
