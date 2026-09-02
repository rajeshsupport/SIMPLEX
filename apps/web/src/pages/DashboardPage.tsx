import React, { useEffect, useState } from 'react';
import {
  Server,
  FileSpreadsheet,
  Laptop,
  History,
  AlertTriangle,
  Play,
  CheckCircle2,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { ApiClient } from '../api/client.js';
import { EnvironmentBadge } from '../components/EnvironmentBadge.js';
import { ClientWithCredentialInfo, DesktopAgentSummary } from '@hmc/shared';
import { Link } from 'react-router-dom';

export const DashboardPage: React.FC = () => {
  const [clients, setClients] = useState<ClientWithCredentialInfo[]>([]);
  const [agents, setAgents] = useState<DesktopAgentSummary[]>([]);
  const [recentRuns, setRecentRuns] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [clientsData, agentsData, runsData, jobsData] = await Promise.all([
          ApiClient.request<ClientWithCredentialInfo[]>('/clients'),
          ApiClient.request<DesktopAgentSummary[]>('/agents'),
          ApiClient.request<any[]>('/agents/runs'),
          ApiClient.request<any[]>('/imports/jobs'),
        ]);

        setClients(clientsData || []);
        setAgents(agentsData || []);
        setRecentRuns(runsData || []);
        setJobs(jobsData || []);
      } catch (err) {
        console.error('Failed to load dashboard data', err);
      } finally {
        setLoading(false);
      }
    }
    loadDashboard();
  }, []);

  const prodClients = clients.filter((c) => c.environment === 'Production');
  const onlineAgents = agents.filter((a) => a.status === 'ONLINE');

  return (
    <div className="space-y-6">
      {/* Top Banner / Production Warning if any prod clients exist */}
      {prodClients.length > 0 && (
        <div className="bg-red-950/40 border border-red-800/80 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-900/50 flex items-center justify-center border border-red-700/60">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <div className="text-sm font-semibold text-red-200">
                {prodClients.length} Production Client(s) Configured
              </div>
              <div className="text-xs text-red-400">
                Live production operations require explicit typed confirmations and operator review.
              </div>
            </div>
          </div>
          <Link
            to="/clients"
            className="px-3 py-1.5 text-xs font-semibold bg-red-900/60 hover:bg-red-800/80 text-red-200 border border-red-700 rounded-lg transition-colors"
          >
            Review Clients
          </Link>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-surface border border-surface-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">HMC Clients</span>
            <Server className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-bold text-white">{clients.length}</div>
          <div className="text-xs text-slate-500 mt-1">
            {prodClients.length} Production • {clients.length - prodClients.length} Non-Prod
          </div>
        </div>

        <div className="bg-surface border border-surface-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Import Jobs</span>
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white">{jobs.length}</div>
          <div className="text-xs text-slate-500 mt-1">
            {jobs.filter((j) => j.status === 'PROCESSING').length} In-Flight • {jobs.filter((j) => j.status === 'SUCCEEDED').length} Completed
          </div>
        </div>

        <div className="bg-surface border border-surface-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Desktop Agents</span>
            <Laptop className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white">{onlineAgents.length}</div>
          <div className="text-xs text-slate-500 mt-1">
            {onlineAgents.length} Online of {agents.length} Registered
          </div>
        </div>

        <div className="bg-surface border border-surface-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Automation Runs</span>
            <History className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-white">{recentRuns.length}</div>
          <div className="text-xs text-slate-500 mt-1">Recent browser automation runs</div>
        </div>
      </div>

      {/* Grid for Clients & Recent Runs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Managed Clients Summary */}
        <div className="bg-surface border border-surface-border rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Server className="w-4 h-4 text-sky-400" />
              Configured HMC Clients
            </h3>
            <Link to="/clients" className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1">
              View All <ExternalLink className="w-3 h-3" />
            </Link>
          </div>

          <div className="space-y-3">
            {clients.length === 0 ? (
              <div className="text-sm text-slate-500 py-6 text-center">No clients configured yet.</div>
            ) : (
              clients.slice(0, 5).map((client) => (
                <div
                  key={client.id}
                  className="p-3.5 rounded-lg bg-slate-900/60 border border-slate-800 flex items-center justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-sky-400">{client.clientCode}</span>
                      <span className="text-xs font-medium text-slate-200">{client.clientName}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">{client.baseUrl}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <EnvironmentBadge environment={client.environment} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Automation Runs */}
        <div className="bg-surface border border-surface-border rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <History className="w-4 h-4 text-emerald-400" />
              Recent Automation Telemetry
            </h3>
            <Link to="/audit" className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1">
              Audit Trail <ExternalLink className="w-3 h-3" />
            </Link>
          </div>

          <div className="space-y-3">
            {recentRuns.length === 0 ? (
              <div className="text-sm text-slate-500 py-6 text-center">No recent automation executions.</div>
            ) : (
              recentRuns.slice(0, 5).map((run) => (
                <div
                  key={run.id}
                  className="p-3.5 rounded-lg bg-slate-900/60 border border-slate-800 flex items-center justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-200">{run.runType}</span>
                      <span className="text-[11px] text-slate-400 font-mono">[{run.client?.clientCode || 'CLIENT'}]</span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(run.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${
                        run.status === 'COMPLETED'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : run.status === 'FAILED'
                          ? 'bg-red-950 text-red-400 border border-red-800'
                          : run.status === 'RUNNING'
                          ? 'bg-sky-950 text-sky-400 border border-sky-800 animate-pulse'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {run.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
