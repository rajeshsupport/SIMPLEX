# Git History Remediation Plan & Pre-Rewrite Readiness

> [!IMPORTANT]
> **Status: AWAITING_EXPLICIT_USER_AUTHORIZATION_FOR_HISTORY_REWRITE**  
> Because this local repository has not been pushed to any remote server (`git status` shows an unpushed local repository on `main`), history rewriting has **not** been executed. This document establishes the exact pre-rewrite readiness and safe procedure for eliminating historical commit `e8a4d17` once authorized.

---

## 1. Current Repository Snapshot & Pre-Rewrite State

| Parameter | Current Value | Verification Output |
|---|---|---|
| **Current Active Branch** | `main` | `git branch --show-current` -> `main` |
| **Current HEAD Commit** | `98dd52a` | `git rev-parse HEAD` -> `98dd52a` |
| **Working Tree Status** | Clean (All changes tracked and verified) | `git status --short` -> clean |
| **Local Branches** | `main` | `git branch` -> `* main` |
| **Git Tags** | 0 tags | `git tag` -> (empty) |
| **Configured Remotes** | 0 remotes (Unpushed local repository) | `git remote -v` -> (empty) |
| **Historically Exposed Commit** | `e8a4d17` | `git log -p -G"Admin@HMC2026"` |
| **Files Affected in `e8a4d17`** | `seed.ts`, `LoginPage.tsx`, `local-installation.md`, `uat-checklist.md` | Confirmed isolated to 4 files |

---

## 2. Step-by-Step Backup & Verification Procedure

Before initiating any history rewrite:

```bash
# 1. Create an immutable safety branch
git branch pre-rewrite-safety-checkpoint-$(date +%Y%m%d%H%M%S)

# 2. Create a complete Git bundle archive outside the repository
git bundle create ../hmc-console-pre-rewrite-backup.bundle --all

# 3. Verify bundle integrity
git bundle verify ../hmc-console-pre-rewrite-backup.bundle
```

---

## 3. Recommended History Sanitization Command (`git-filter-repo`)

`git-filter-repo` is the official Python-based tool recommended by the Git core team:

```bash
# 1. Create a replacement file specifying the exact secret pattern to redact
echo "regex:(?i)compromised_secret_string==>[CONFIGURED_VIA_ADMIN_BOOTSTRAP]" > /tmp/replace-secrets.txt

# 2. Run git-filter-repo across all commits
git-filter-repo --replace-text /tmp/replace-secrets.txt --force

# 3. Clean up the temporary replacement definition
rm /tmp/replace-secrets.txt
```

---

## 4. Post-Rewrite Verification & Integrity Audit

Immediately following the rewrite:

1. **Grep and Git Log Verification**:
   ```bash
   git log -p --all -G"compromised_pattern"
   # Must return ZERO commits
   ```
2. **Commit Hash Reconciliation**:
   - `e8a4d17` will be replaced by a clean sanitized commit hash.
   - Subsequent commits (`121925f`, `98dd52a`) will receive new parent commit hashes.
   - Record the old-to-new commit mapping table from `.git/filter-repo/commit-map`.
3. **Full Build & Test Verification**:
   ```bash
   pnpm build && pnpm test
   ```

---

## 5. Rollback Procedure (In Case of Any Disruption)

If history rewriting encounters an error or produces unexpected tree states:

```bash
# 1. Restore repository from verified bundle
cd ..
rm -rf SIMPLEX
git clone ../hmc-console-pre-rewrite-backup.bundle SIMPLEX
cd SIMPLEX
```

---

## 6. Execution Gate

```
================================================================================
AWAITING_EXPLICIT_USER_AUTHORIZATION_FOR_HISTORY_REWRITE
================================================================================
```
