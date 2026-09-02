# Log Retention & Archiving Policy

## 1. Default Retention Windows

| Artifact / Log Type | Retention Window | Purge Strategy |
|---|---|---|
| **Automation Screenshots** | 30 Days | Hard delete on local disk and `stored_files` |
| **Detailed Error Logs** | 90 Days | Hard delete from `error_logs` |
| **Security & Audit Logs** | 365 Days | Compressed export to archive before deletion |
| **Import Job Summaries** | 365 Days | Summary retained; raw row payloads archived |

---

## 2. Configuration & Execution

- Retention policies are managed in the database table `retention_policies`.
- Administrators can adjust retention days via `/retention/policies` or the Web UI Settings tab.
- Purges can be executed on a schedule or triggered manually via `POST /retention/purge`.
