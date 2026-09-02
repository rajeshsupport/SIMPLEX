# Sensitive Backup Retention & Security Register

> **Status: SENSITIVE_BACKUP_RETENTION_PENDING**  
> **Retention Policy: AWAITING_EXPLICIT_DELETION_AUTHORIZATION**

---

## 1. Sensitive Pre-Rewrite Backup Metadata

| Parameter | Recorded Value | Verification Details |
|---|---|---|
| **Artifact Path** | `/Users/sharmila/Music/hmc-console-pre-rewrite-backup.bundle` *(Abbr: `.../Music/hmc-console-pre-rewrite-backup.bundle`)* | Validated outside repository; non-symlink regular file |
| **File Size** | `288,367 bytes` (~288 KB) | Confirmed via `ls -la` |
| **SHA-256 Checksum** | `66f095b8b2ee0287325d7abb8187867c67b40b05218bb90c0639207e8bde6dad` | Verified via `shasum -a 256` without opening content |
| **Owner / Group** | `sharmila:staff` | Confirmed current authorized local user |
| **POSIX File Mode** | `0600` (`-rw-------`) | Strict owner read/write only; restricted from group/others |
| **Parent Directory** | `/Users/sharmila/Music` | Local user home folder; not publicly shared or synced |
| **Encryption Tool Availability** | `BLOCKED_BACKUP_ENCRYPTION_TOOL_UNAVAILABLE` | `age` and `gpg` not present in environment; retained under `0600` ACL |

---

## 2. Recovery Drill & Verification Evidence

- **Verification Command**: `git bundle verify /Users/sharmila/Music/hmc-console-pre-rewrite-backup.bundle` (Exit Code `0`).
- **Refs Contained**:
  - `refs/heads/main` (`dd162f7`)
  - `refs/heads/pre-rewrite-safety-backup` (`dd162f7`)
  - `HEAD` (`dd162f7`)
- **Recovery Drill Execution**:
  - Successfully cloned into temporary directory `/tmp/hmc-recovery-drill-UfZBLF`.
  - Verified accessibility of all 7 pre-rewrite commits (`dd162f7`, `7d5337a`, `3cd0b7b`, `919586e`, `98dd52a`, `121925f`, `e8a4d17`).
  - Confirmed pre-rewrite HEAD `dd162f7` was fully recoverable.
  - Safely deleted temporary directory after drill completion.

---

## 3. Formal Retention Statement

> **The active Git revision graph is sanitized. The access-controlled pre-rewrite recovery bundle intentionally retains the original history and is pending an authorized retention or secure-deletion decision.**
