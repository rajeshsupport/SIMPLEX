import React, { useState, useEffect } from 'react';
import {
  FileSpreadsheet,
  Upload,
  CheckCircle,
  AlertCircle,
  Play,
  Pause,
  RotateCcw,
  XOctagon,
  Download,
  Server,
  Layers,
  Check,
} from 'lucide-react';
import { ApiClient } from '../api/client.js';
import { EnvironmentBadge } from '../components/EnvironmentBadge.js';
import {
  ImportPreviewSummary,
  ImportJobType,
  ClientWithCredentialInfo,
} from '@hmc/shared';

export const ImportsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'WIZARD' | 'JOBS'>('WIZARD');
  const [jobType, setJobType] = useState<ImportJobType>('SERVICE_MASTER');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewSummary | null>(null);
  const [customMappings, setCustomMappings] = useState<Record<string, string>>({});
  const [clients, setClients] = useState<ClientWithCredentialInfo[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [oneRecordTestMode, setOneRecordTestMode] = useState<boolean>(false);
  const [typedConfirmation, setTypedConfirmation] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<any[]>([]);
  const [selectedJob, setSelectedJob] = useState<any | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [clientsData, jobsData] = await Promise.all([
          ApiClient.request<ClientWithCredentialInfo[]>('/clients'),
          ApiClient.request<any[]>('/imports/jobs'),
        ]);
        setClients(clientsData || []);
        if (clientsData && clientsData.length > 0) {
          setSelectedClientId(clientsData[0].id);
        }
        setJobs(jobsData || []);
      } catch (err) {
        console.error('Failed to load import data', err);
      }
    }
    loadData();
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setLoading(true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('jobType', jobType);

    try {
      const res = await ApiClient.request<ImportPreviewSummary>('/imports/preview', {
        method: 'POST',
        body: formData,
      });
      setPreview(res);
      setCustomMappings(res.suggestedMappings || {});
    } catch (err: any) {
      alert(`Preview failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStartImport = async () => {
    if (!selectedFile || !selectedClientId) {
      alert('Please select a file and target client');
      return;
    }

    const client = clients.find((c) => c.id === selectedClientId);
    if (client?.environment === 'Production') {
      if (typedConfirmation.trim().toUpperCase() !== client.clientCode.toUpperCase()) {
        alert(`Production import requires typing the exact client code '${client.clientCode}'`);
        return;
      }
    }

    setLoading(true);
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('clientId', selectedClientId);
    formData.append('jobType', jobType);
    formData.append('oneRecordTestMode', String(oneRecordTestMode));
    if (typedConfirmation) {
      formData.append('typedConfirmation', typedConfirmation);
    }
    formData.append('columnMappings', JSON.stringify(customMappings));

    try {
      const job = await ApiClient.request('/imports/jobs', {
        method: 'POST',
        body: formData,
      });
      alert(`Import Job created successfully (ID: ${job.id.substring(0, 8)})`);
      setActiveTab('JOBS');
      // Refresh jobs
      const jobsData = await ApiClient.request<any[]>('/imports/jobs');
      setJobs(jobsData || []);
      setSelectedJob(await ApiClient.request(`/imports/jobs/${job.id}`));
    } catch (err: any) {
      alert(`Failed to create import job: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePauseJob = async (id: string) => {
    await ApiClient.request(`/imports/jobs/${id}/pause`, { method: 'POST' });
    refreshJobs();
  };

  const handleResumeJob = async (id: string) => {
    await ApiClient.request(`/imports/jobs/${id}/resume`, { method: 'POST' });
    refreshJobs();
  };

  const handleRetryJob = async (id: string) => {
    await ApiClient.request(`/imports/jobs/${id}/retry`, { method: 'POST' });
    refreshJobs();
  };

  const handleCancelJob = async (id: string) => {
    await ApiClient.request(`/imports/jobs/${id}/cancel`, { method: 'POST' });
    refreshJobs();
  };

  const handleExportErrors = async (id: string) => {
    try {
      const blob = await ApiClient.request<Blob>(`/imports/jobs/${id}/export-errors`);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `import-errors-${id.substring(0, 8)}.csv`;
      a.click();
    } catch (err: any) {
      alert(`Export error: ${err.message}`);
    }
  };

  const refreshJobs = async () => {
    const jobsData = await ApiClient.request<any[]>('/imports/jobs');
    setJobs(jobsData || []);
    if (selectedJob) {
      setSelectedJob(await ApiClient.request(`/imports/jobs/${selectedJob.id}`));
    }
  };

  const selectedClient = clients.find((c) => c.id === selectedClientId);

  return (
    <div className="space-y-6">
      {/* Tab Selector */}
      <div className="flex items-center justify-between border-b border-surface-border pb-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Spreadsheet Batch Operations</h2>
          <p className="text-xs text-slate-400">Validate, preview, and execute resilient imports across HMC clients</p>
        </div>

        <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setActiveTab('WIZARD')}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              activeTab === 'WIZARD' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            Import Wizard
          </button>
          <button
            onClick={() => setActiveTab('JOBS')}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              activeTab === 'JOBS' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            Jobs History & Progress ({jobs.length})
          </button>
        </div>
      </div>

      {activeTab === 'WIZARD' ? (
        <div className="space-y-6">
          {/* Step 1: Upload & Type */}
          <div className="bg-surface border border-surface-border rounded-xl p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-100 mb-3 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-sky-600 text-white flex items-center justify-center text-xs">1</span>
              Select Import Type & Upload Spreadsheet
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Import Workflow</label>
                <select
                  value={jobType}
                  onChange={(e) => setJobType(e.target.value as ImportJobType)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
                >
                  <option value="SERVICE_MASTER">Service Master (Catalog & Pricing)</option>
                  <option value="USER_CREATION">User Creation (Staff & Roles)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">File (.xlsx or .csv)</label>
                <div className="relative border-2 border-dashed border-slate-700 hover:border-sky-500 rounded-lg p-3 text-center transition-colors cursor-pointer bg-slate-900/50">
                  <input
                    type="file"
                    accept=".xlsx,.csv,.xls"
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="flex items-center justify-center gap-2 text-xs text-slate-300">
                    <Upload className="w-4 h-4 text-sky-400" />
                    <span>{selectedFile ? selectedFile.name : 'Choose file or drag & drop here'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Step 2 & 3: Preview & Mapping (if file parsed) */}
          {preview && (
            <div className="bg-surface border border-surface-border rounded-xl p-6 shadow-sm space-y-4 animate-in fade-in">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-sky-600 text-white flex items-center justify-center text-xs">2</span>
                  Data Validation & Mapping Preview
                </h3>

                <div className="flex items-center gap-3 text-xs">
                  <span className="text-slate-400">Total: <strong>{preview.totalRows}</strong></span>
                  <span className="text-emerald-400">Valid: <strong>{preview.validRowsCount}</strong></span>
                  <span className="text-red-400">Invalid: <strong>{preview.invalidRowsCount}</strong></span>
                  <span className="text-amber-400">Duplicates: <strong>{preview.duplicateRowsCount}</strong></span>
                </div>
              </div>

              {/* Preview Table */}
              <div className="border border-surface-border rounded-lg overflow-x-auto max-h-64">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 text-slate-400 sticky top-0">
                    <tr>
                      <th className="py-2 px-3">Row #</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Mapped Values</th>
                      <th className="py-2 px-3">Errors</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border font-mono">
                    {preview.previewRows.map((r) => (
                      <tr key={r.rowIndex} className={r.isValid ? '' : 'bg-red-950/20'}>
                        <td className="py-2 px-3">{r.rowIndex}</td>
                        <td className="py-2 px-3">
                          {r.isValid ? (
                            <span className="text-emerald-400 flex items-center gap-1 font-sans">
                              <Check className="w-3 h-3" /> Valid
                            </span>
                          ) : (
                            <span className="text-red-400 flex items-center gap-1 font-sans">
                              <AlertCircle className="w-3 h-3" /> Invalid
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-[11px] text-slate-300">
                          {JSON.stringify(r.mappedValues)}
                        </td>
                        <td className="py-2 px-3 text-red-400 text-[11px]">
                          {r.validationErrors.join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Step 4: Target Client & Production Confirmations */}
              <div className="pt-4 border-t border-surface-border grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Target HMC Client</label>
                  <select
                    value={selectedClientId}
                    onChange={(e) => setSelectedClientId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
                  >
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        [{c.environment}] {c.clientCode} - {c.clientName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Execution Mode</label>
                  <div className="flex items-center gap-4 pt-2">
                    <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={oneRecordTestMode}
                        onChange={(e) => setOneRecordTestMode(e.target.checked)}
                        className="rounded border-slate-700 text-sky-600 focus:ring-sky-500"
                      />
                      One-Record Test Mode (Dry Run first row only)
                    </label>
                  </div>
                </div>
              </div>

              {/* Production Guardrail Warning */}
              {selectedClient?.environment === 'Production' && (
                <div className="p-4 bg-red-950/60 border border-red-800 rounded-xl space-y-2 text-red-300 text-xs">
                  <div className="font-bold flex items-center gap-2 text-red-200">
                    <AlertCircle className="w-4 h-4 text-red-400" />
                    LIVE PRODUCTION TARGET SELECTED
                  </div>
                  <p>
                    You are executing a batch import on live Production client <strong>[{selectedClient.clientCode}]</strong>.
                    Type the exact client code to confirm:
                  </p>
                  <input
                    type="text"
                    value={typedConfirmation}
                    onChange={(e) => setTypedConfirmation(e.target.value)}
                    placeholder={selectedClient.clientCode}
                    className="w-full px-3 py-2 bg-slate-900 border border-red-700 rounded-lg text-xs font-mono text-white focus:outline-none"
                  />
                </div>
              )}

              {/* Launch Action */}
              <div className="flex justify-end pt-2">
                <button
                  onClick={handleStartImport}
                  disabled={loading}
                  className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-emerald-900/30 transition-all disabled:opacity-50"
                >
                  <Play className="w-4 h-4 fill-current" />
                  {loading ? 'Creating Job...' : 'Authorize & Start Batch Import'}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Jobs List & Live Execution */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Jobs List */}
          <div className="bg-surface border border-surface-border rounded-xl p-4 shadow-sm space-y-2 lg:col-span-1 max-h-[750px] overflow-y-auto">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Import Jobs</h3>
            {jobs.length === 0 ? (
              <div className="text-xs text-slate-500 py-6 text-center">No import jobs executed yet.</div>
            ) : (
              jobs.map((job) => (
                <div
                  key={job.id}
                  onClick={async () => setSelectedJob(await ApiClient.request(`/imports/jobs/${job.id}`))}
                  className={`p-3 rounded-lg border text-xs cursor-pointer transition-all ${
                    selectedJob?.id === job.id
                      ? 'bg-sky-950/40 border-sky-500/80 text-sky-200'
                      : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold">{job.jobType}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      job.status === 'SUCCEEDED' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                      job.status === 'PROCESSING' ? 'bg-sky-950 text-sky-400 border border-sky-800 animate-pulse' :
                      job.status === 'PAUSED' ? 'bg-amber-950 text-amber-400 border border-amber-800' :
                      job.status === 'FAILED' ? 'bg-red-950 text-red-400 border border-red-800' : 'bg-slate-800 text-slate-400'
                    }`}>
                      {job.status}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">{job.originalFileName}</div>
                  <div className="text-[10px] text-slate-500 mt-1 flex justify-between">
                    <span>{job.client?.clientCode || 'Client'}</span>
                    <span>{job.succeededRows}/{job.totalRows} succeeded</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Job Details & Progress */}
          <div className="bg-surface border border-surface-border rounded-xl p-6 shadow-sm lg:col-span-2 space-y-6">
            {selectedJob ? (
              <>
                <div className="flex items-center justify-between border-b border-surface-border pb-4">
                  <div>
                    <h3 className="text-base font-bold text-white">{selectedJob.originalFileName}</h3>
                    <p className="text-xs text-slate-400 font-mono">Job ID: {selectedJob.id} • Target: [{selectedJob.client?.clientCode}]</p>
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedJob.status === 'PROCESSING' && (
                      <button
                        onClick={() => handlePauseJob(selectedJob.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600/20 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-semibold hover:bg-amber-600/30"
                      >
                        <Pause className="w-3.5 h-3.5" /> Pause
                      </button>
                    )}

                    {selectedJob.status === 'PAUSED' && (
                      <button
                        onClick={() => handleResumeJob(selectedJob.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 rounded-lg text-xs font-semibold hover:bg-emerald-600/30"
                      >
                        <Play className="w-3.5 h-3.5" /> Resume
                      </button>
                    )}

                    {(selectedJob.status === 'FAILED' || selectedJob.failedRows > 0) && (
                      <button
                        onClick={() => handleRetryJob(selectedJob.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600/20 text-sky-300 border border-sky-500/40 rounded-lg text-xs font-semibold hover:bg-sky-600/30"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Retry Failed
                      </button>
                    )}

                    {selectedJob.failedRows > 0 && (
                      <button
                        onClick={() => handleExportErrors(selectedJob.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-700"
                      >
                        <Download className="w-3.5 h-3.5" /> Export Errors CSV
                      </button>
                    )}

                    {selectedJob.status === 'PROCESSING' && (
                      <button
                        onClick={() => handleCancelJob(selectedJob.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/20 text-red-300 border border-red-500/40 rounded-lg text-xs font-semibold hover:bg-red-600/30"
                      >
                        <XOctagon className="w-3.5 h-3.5" /> Cancel
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                <div>
                  <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                    <span>Processing Progress</span>
                    <span>{Math.round(((selectedJob.succeededRows + selectedJob.failedRows) / (selectedJob.totalRows || 1)) * 100)}%</span>
                  </div>
                  <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden flex border border-slate-800">
                    <div
                      style={{ width: `${(selectedJob.succeededRows / (selectedJob.totalRows || 1)) * 100}%` }}
                      className="bg-emerald-500 h-full transition-all"
                    />
                    <div
                      style={{ width: `${(selectedJob.failedRows / (selectedJob.totalRows || 1)) * 100}%` }}
                      className="bg-red-500 h-full transition-all"
                    />
                  </div>
                </div>

                {/* Rows Table */}
                <div className="border border-surface-border rounded-lg overflow-x-auto max-h-96">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900 text-slate-400 sticky top-0 font-semibold">
                      <tr>
                        <th className="py-2.5 px-3">Row</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3">Payload</th>
                        <th className="py-2.5 px-3">Error / Outcome</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-border font-mono text-[11px]">
                      {(selectedJob.rows || []).map((row: any) => (
                        <tr key={row.id}>
                          <td className="py-2 px-3">{row.rowIndex}</td>
                          <td className="py-2 px-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-sans font-semibold ${
                              row.status === 'SUCCEEDED' ? 'bg-emerald-950 text-emerald-400' :
                              row.status === 'FAILED' ? 'bg-red-950 text-red-400' :
                              row.status === 'PROCESSING' ? 'bg-sky-950 text-sky-400' : 'bg-slate-800 text-slate-400'
                            }`}>
                              {row.status}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-slate-300 max-w-xs truncate">{row.mappedDataJson || row.rawDataJson}</td>
                          <td className="py-2 px-3 text-red-400">{row.errorMessage || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="text-center py-16 text-slate-500 text-xs">
                Select an import job from the left list to view live execution details.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
