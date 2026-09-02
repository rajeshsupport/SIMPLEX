export type AuditResult = 'SUCCESS' | 'FAILURE' | 'DENIED' | 'SECURITY_BLOCK';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorUserId?: string | null;
  actorUsername?: string | null;
  clientId?: string | null;
  clientCode?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  result: AuditResult;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  importJobId?: string | null;
  automationRunId?: string | null;
  details?: Record<string, any> | null;
}

export interface ErrorLogEntry {
  id: string;
  timestamp: string;
  correlationId?: string | null;
  serviceName: string;
  level: 'ERROR' | 'FATAL' | 'WARN';
  message: string;
  stackTrace?: string | null;
  context?: Record<string, any> | null;
}

export interface RetentionPolicyConfig {
  id: string;
  logType: 'SCREENSHOTS' | 'ERROR_LOGS' | 'AUDIT_LOGS' | 'IMPORT_SUMMARIES';
  retentionDays: number;
  isArchiveEnabled: boolean;
  archiveDestination?: string | null;
  lastPurgedAt?: string | null;
  updatedAt: string;
}
