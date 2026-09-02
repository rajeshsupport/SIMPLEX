import React, { useEffect, useState } from 'react';
import { Laptop, Activity, Wifi, WifiOff, Clock, ShieldCheck } from 'lucide-react';
import { ApiClient } from '../api/client.js';
import { DesktopAgentSummary } from '@hmc/shared';

export const AgentsPage: React.FC = () => {
  const [agents, setAgents] = useState<DesktopAgentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAgents = async () => {
    try {
      setLoading(true);
      const data = await ApiClient.request<DesktopAgentSummary[]>('/agents');
      setAgents(data || []);
    } catch (err) {
      console.error('Failed to load desktop agents', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAgents();
    const interval = setInterval(loadAgents, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">Desktop Automation Agents</h2>
        <p className="text-xs text-slate-400">
          Authorized operator machines running persistent browser automation with isolated profiles
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading && agents.length === 0 ? (
          <div className="col-span-3 text-center py-12 text-slate-500 text-xs">Loading agent statuses...</div>
        ) : agents.length === 0 ? (
          <div className="col-span-3 bg-surface border border-surface-border rounded-xl p-8 text-center text-slate-500 text-xs">
            No desktop agents registered yet. Start `apps/desktop-agent` to automatically pair your operator client.
          </div>
        ) : (
          agents.map((agent) => {
            const isOnline = agent.status === 'ONLINE';
            return (
              <div
                key={agent.id}
                className="bg-surface border border-surface-border rounded-xl p-5 shadow-sm space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-indigo-950/60 border border-indigo-800 flex items-center justify-center">
                      <Laptop className="w-4 h-4 text-indigo-400" />
                    </div>
                    <div>
                      <div className="font-bold text-sm text-white">{agent.agentName}</div>
                      <div className="text-[11px] font-mono text-slate-400">{agent.machineHostname}</div>
                    </div>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      isOnline
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800 animate-pulse'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                    {agent.status}
                  </span>
                </div>

                <div className="text-xs space-y-1.5 pt-2 border-t border-surface-border text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Operating System:</span>
                    <span className="font-mono text-slate-300">{agent.osInfo}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Assigned User:</span>
                    <span className="font-semibold text-sky-400">{agent.assignedUsername || 'Unassigned'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Last Heartbeat:</span>
                    <span className="font-mono text-slate-400">
                      {agent.lastHeartbeatAt ? new Date(agent.lastHeartbeatAt).toLocaleTimeString() : 'Never'}
                    </span>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center gap-2 text-[11px] text-slate-400">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Isolated profile encryption active</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
