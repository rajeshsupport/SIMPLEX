# Sensitive & Sanitized Backup Retention Register

> **Unsanitized Backup Status: `UNSANITIZED_BACKUP_PENDING_DELETION_AUTHORIZATION`**  
> **Sanitized Backup Status: `SANITIZED_RECOVERY_BUNDLE_VERIFIED`**  
> **Location Sync Status: `SANITIZED_BACKUP_LOCATION_SYNC_STATUS_UNVERIFIED`**

---

## 1. Inventory of Recovery Artifacts

### A. Existing Unsanitized Sensitive Backup
| Parameter | Value | Notes |
|---|---|---|
| **Path** | `/Users/sharmila/Music/hmc-console-pre-rewrite-backup.bundle` | Outside active repository; non-symlink |
| **Size** | `288,367 bytes` (~288 KB) | Confirmed via `ls -la` |
| **SHA-256** | `66f095b8b2ee0287325d7abb8187867c67b40b05218bb90c0639207e8bde6dad` | Verified checksum |
| **Permissions** | `0600` (`-rw-------`) | Owner read/write only |
| **Parent Dir** | `/Users/sharmila/Music` (`0700` mode) | Local APFS volume |
| **Status** | **`UNSANITIZED_BACKUP_PENDING_DELETION_AUTHORIZATION`** | Contains historical commit `e8a4d17` |

### B. New Clean Sanitized Recovery Bundle
| Parameter | Value | Notes |
|---|---|---|
| **Path** | `/Users/sharmila/HMC_Secure_Backups/hmc-console-sanitized-c30537d.bundle` | Dedicated backup directory; non-symlink |
| **Sidecar Path** | `/Users/sharmila/HMC_Secure_Backups/hmc-console-sanitized-c30537d.bundle.sha256` | Checksum sidecar file |
| **Size** | `303,074 bytes` (~303 KB) | Confirmed via `ls -la` |
| **SHA-256** | `710bf59208c2fb2c8fc4650a41647f9cdd7b0cde0a1f9c82db284c7ae06bd7c5` | Verified checksum |
| **Permissions** | `0600` on bundle and sidecar; `0700` on parent dir | Strict owner access only |
| **Parent Dir** | `/Users/sharmila/HMC_Secure_Backups` | Created specifically for clean backups |
| **Status** | **`SANITIZED_RECOVERY_BUNDLE_VERIFIED`** | Covers active graph through `c30537d` |

---

## 2. Retention Policy & Containment Notice

> **The active Git revision graph is sanitized. The new sanitized recovery bundle provides a verified, clean recovery path. The access-controlled pre-rewrite recovery bundle intentionally retains the original history and is pending an authorized retention or secure-deletion decision.**
