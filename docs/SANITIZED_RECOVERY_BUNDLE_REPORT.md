# Sanitized Recovery Bundle Report & Verification Evidence

> **Bundle Status: `SANITIZED_RECOVERY_BUNDLE_VERIFIED`**  
> **Covered Repository Commit: `c30537d763440a81cf3fb728619b0d82de867ef0` (`c30537d`)**  
> **Parent Directory Mode: `0700` | Bundle File Mode: `0600`**

---

## 1. Sanitized Recovery Bundle Metadata

| Parameter | Recorded Specification / Value | Verification Status |
|---|---|---|
| **Bundle File Path** | `/Users/sharmila/HMC_Secure_Backups/hmc-console-sanitized-c30537d.bundle` *(Abbr: `.../HMC_Secure_Backups/hmc-console-sanitized-c30537d.bundle`)* | Validated outside active repository; non-symlink regular file |
| **Checksum Sidecar Path** | `/Users/sharmila/HMC_Secure_Backups/hmc-console-sanitized-c30537d.bundle.sha256` | Single-entry standard format |
| **File Size** | `303,074 bytes` (~303 KB) | Confirmed via `ls -la` |
| **SHA-256 Checksum** | `710bf59208c2fb2c8fc4650a41647f9cdd7b0cde0a1f9c82db284c7ae06bd7c5` | Verified via `shasum -a 256` |
| **Owner / Group** | `sharmila:staff` | Current authorized user |
| **POSIX Permissions** | `0600` (`-rw-------`) on bundle and sidecar; `0700` (`drwx------`) on parent directory | Strict owner access only |
| **Reachable Commits** | `10` commits (linear history from root `00494b4` to `c30537d`) | Verified |
| **Contained Refs** | `HEAD`, `refs/heads/main` | Verified |
| **Location Sync Status** | `SANITIZED_BACKUP_LOCATION_SYNC_STATUS_UNVERIFIED` | Local APFS volume; access-controlled |

> *Note: This sanitized bundle captures the active repository state through commit `c30537d`. The subsequent documentation commit recording this verification report is not included inside the bundle.*

---

## 2. Recovery Drill Evidence

- **`git bundle verify`**: Passed with Exit Code `0`.
- **Restored HEAD**: `c30537d763440a81cf3fb728619b0d82de867ef0` (**100% HEAD Match**).
- **Restored Tree Hash**: `89095d685272da0ee68e65b324238fda8a2d56b7` (**100% Tree Hash Match**).
- **`git fsck --full` on Restored Repo**: Passed (`CLEAN_PASS`, 0 errors).
- **Restored Working Tree**: Clean (`0` uncommitted changes).
- **Secret Scan on Restored Commits**: `git log -p --all -G"[COMPROMISED_PATTERN]"` returned **0 findings**.
- **Restored Standalone Build/Test**: `RESTORED_BUILD_BLOCKED_DEPENDENCIES` (Offline standalone clone without global pnpm virtual store links).

---

## 3. Comparison of Recovery Options

### A. Old Unsanitized Bundle
- **Location**: `/Users/sharmila/Music/hmc-console-pre-rewrite-backup.bundle`
- **Contents**: Full pre-rewrite history (contains original commit `e8a4d17` with old credential).
- **Security**: Access-controlled with `0600` mode. Must **never** be pushed, shared, or casual-cloned.
- **Status**: **`UNSANITIZED_BACKUP_PENDING_DELETION_AUTHORIZATION`**

### B. New Sanitized Bundle
- **Location**: `/Users/sharmila/HMC_Secure_Backups/hmc-console-sanitized-c30537d.bundle`
- **Contents**: Clean sanitized revision graph through commit `c30537d`.
- **Security**: Verified checksum, verified restore, 0 secret occurrences.
- **Status**: **`SANITIZED_RECOVERY_BUNDLE_VERIFIED`**
