# Security Architecture & Credential Protection

## 1. Zero Default Credentials & Secure Admin Bootstrap

- **No Hardcoded Accounts**: There are zero default administrator accounts or passwords in the source code or seed scripts.
- **Interactive Bootstrap Command (`pnpm admin:bootstrap`)**:
  - Prompts for Super Admin credentials through a masked interactive prompt.
  - Requires password confirmation.
  - Enforces password complexity policy (min 10 chars, uppercase, lowercase, digit, special symbol).
  - Hashes passwords using **Argon2id** (memory cost: 64MB, time cost: 3 iterations, parallelism: 4 threads).
  - Never logs or prints password values.
  - Refuses to overwrite existing accounts without explicit interactive confirmation.
  - Logs the provisioning event to `audit_logs` table with unique correlation IDs.

---

## 2. Credential Security & Envelope Encryption

- **Master Encryption Key**: Loaded exclusively from runtime secret `ENCRYPTION_MASTER_KEY` (never committed to repository). Format and entropy are strictly validated on startup (must be 64-char hexadecimal string with byte and character diversity thresholds).
- **AES-256-GCM Envelope Encryption**: Client passwords and usernames are encrypted with a fresh 96-bit (12-byte) initialization vector (IV) and a 128-bit authentication tag for integrity verification.
- **Credential Masking**: All user interfaces and logging pipelines display only masked placeholders (e.g. `ad***@client.com` and `********`). Decrypted credentials exist only in memory during active Playwright execution.

---

## 3. Session & Browser Profile Isolation

- **Isolated Storage per `{clientId}/{userId}`**: Persistent profiles are located in `~/.hmc-console/profiles/client_{clientId}/user_{userId}`.
- **Restrictive POSIX Permissions (`0700`)**: Profile directories are created with `0700` mode, restricting read, write, and execute permissions exclusively to the operating workstation user.
- **Cross-Client Session Leak Prevention**: Cookies, local storage, and active sessions for Client A are physically isolated and cannot be loaded by Client B.
- **Security Checkpoints**: Automatic safe halt upon detection of MFA, SMS OTP, or CAPTCHA challenges (`REQUIRES_MANUAL_INTERVENTION`) with zero bypass attempts.

---

## 4. Authentication & Account Protection

- **Password Hashing**: Application user credentials use **Argon2id** (memory cost: 64MB, time cost: 3 iterations, parallelism: 4 threads).
- **JWT Lifecycles**:
  - Access Token: 15 minutes validity
  - Refresh Token: 7 days validity with single-use cryptographic rotation
- **Lockout Policy**: 5 failed login attempts trigger an automatic 15-minute account lockout.
- **Audit Trails & Hash Chaining**: All authentication attempts (success, failed credentials, locked out) are captured in `application_login_history` and `audit_logs` with SHA-256 block chaining to detect tampering.

---

## 5. RBAC & Client Access Boundary

Authorization is enforced at 3 levels on every request:

1. **Role Level**: Super Admin, Admin, Import Operator, URL Operator, Auditor, Viewer.
2. **Action Level**: `@RequirePermissions(...)` on controllers.
3. **Client Level**: `@RequireClientAccess(...)` ensures operators can only view or execute against assigned clients.
