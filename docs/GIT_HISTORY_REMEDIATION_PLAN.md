# Git History Remediation Plan

> [!IMPORTANT]
> **Status: PENDING USER AUTHORIZATION**  
> Because this local repository has not been pushed to any remote server (`git status` shows unpushed local repository), history rewriting has **not** been executed automatically. This document outlines the safe procedure for cleaning historical commit `e8a4d17` before the first push.

---

## 1. Scope of Historical Exposure

- **Affected Commit**: `e8a4d17` (*"feat: complete HMC Central Operations Console production-grade delivery"*)
- **Affected Files**:
  - `packages/database/src/seeds/seed.ts`
  - `apps/web/src/pages/LoginPage.tsx`
  - `docs/local-installation.md`
  - `docs/uat-checklist.md`
- **Active Working Tree**: Clean (all current source files and build artifacts contain zero occurrences of the compromised credential).

---

## 2. Pre-Rewrite Backup Procedure

Before executing any history rewriting, create an immutable local backup branch and archive:

```bash
# 1. Create a safety backup branch
git branch pre-remediation-backup-$(date +%Y%m%d%H%M%S)

# 2. Create a clean bundle archive outside the repository
git bundle create ../hmc-console-pre-rewrite-backup.bundle --all
```

---

## 3. Recommended History Sanitization Command

Use `git-filter-repo` (the modern, official Git replacement for `git filter-branch`):

```bash
# 1. Install git-filter-repo (if not present)
# brew install git-filter-repo OR pip install git-filter-repo

# 2. Create a replacement file (replace-secrets.txt)
# Replace the compromised string with a generic placeholder [CONFIGURED_VIA_ADMIN_BOOTSTRAP]
echo "regex:(?i)compromised_secret_pattern==>[CONFIGURED_VIA_ADMIN_BOOTSTRAP]" > /tmp/replace-secrets.txt

# 3. Execute git-filter-repo
git-filter-repo --replace-text /tmp/replace-secrets.txt --force

# 4. Remove temporary replacement map
rm /tmp/replace-secrets.txt
```

---

## 4. Post-Rewrite Verification & Integrity Checklist

After history rewriting is executed:

1. **Full History Scan**:
   ```bash
   git log -p -S "compromised_pattern" --all
   # Expected output: 0 commits found
   ```
2. **Scanner Verification**: Run `gitleaks detect --source . --verbose`.
3. **Commit Hash Reconciliation**: Note that historical commit hashes (including `e8a4d17` and `121925f`) will be rewritten.
4. **Rebuild & Re-test**:
   ```bash
   pnpm build && pnpm test
   ```

---

## 5. First-Push Checklist

- [ ] History rewritten and verified clean across all commits, tags, and branches.
- [ ] No remote tracking branches existed prior to cleanup.
- [ ] Remote repository initialized with empty default branch.
- [ ] Push executed with standard push:
  ```bash
  git push -u origin main
  ```
- [ ] Mandatory external rotation: If the compromised password was ever used or tested in any shared or external environment, that external credential must be rotated immediately regardless of Git cleanup.
