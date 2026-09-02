# Real-Client Pilot Entry Checklist & Governance Package

> **Pilot Status: `PENDING_PILOT`**  
> **Production Gate: `NO-GO`**  
> *Notice: No access to any real hospital client environment may be initiated without a signed authorization package.*

---

## 1. Governance & Authorization Parameters

| Parameter | Specification | Pilot Instance Record |
|---|---|---|
| **Authorized Facility / Client Code** | Formal partner hospital ID | `[TO_BE_FILLED_BY_PILOT_LEAD]` |
| **Client Environment Tier** | Pre-production / Staging / Test HMC | `[STAGING / UAT]` |
| **Approved Target HMC Base URL** | Verified HTTPS endpoint | `https://[client-subdomain].hmc-system.local` |
| **Designated Pilot Tester** | Certified Operator Name & Employee ID | `[OPERATOR_NAME_AND_ID]` |
| **Authorized Execution Window** | Scheduled maintenance/test window | `YYYY-MM-DD HH:MM to YYYY-MM-DD HH:MM (UTC)` |
| **Application Software Version** | Tagged release build | `v1.0.0-rc1` |
| **Automation Selector Pack Version** | HMC workflow definition schema | `v1.0` |
| **Central Console API Host** | Central operations deployment | `https://console.hmc-central.internal` |

---

## 2. Permitted Test Scenarios & Scope

### Category A: Read-Only Smoke Scenarios (Mandatory First Phase)
1. **Interactive Headed Launch**: Operator triggers "Open & Login" from Desktop Agent. Verifies isolated Chromium launch under `~/.hmc-console/profiles/client_{clientId}/user_{userId}` with `0700` permissions.
2. **Navigation & Selector Verification**: Verifies presence of target navigation headers and DOM markers (`input-username`, `input-password`, `btn-login`, `hmc-dashboard`).
3. **Session State Verification**: Confirms login success and persistence without recording session cookies in logs.

### Category B: Permitted Controlled Mutation Scenarios (Pilot Phase)
1. **Single Test Service Insertion**: Inserts a designated synthetic test service code (e.g. `PILOT-TEST-001`) with clear test nomenclature (`[PILOT TEST] General Examination`).
2. **Spreadsheet Batch Import (5 Rows Max)**: Runs a dry-run batch import of 5 synthetic service rows. Tests row-by-row execution, status checkpointing, and pause/resume triggers.

---

## 3. Rollback & Remediation Procedures

If any unexpected mutation, workflow stall, or selector misalignment occurs:
1. **Immediate Execution Abort**: Click "Emergency Halt" in the Desktop Agent or web console to terminate the active Chromium worker.
2. **Synthetic Record Removal**: Execute the pre-scripted rollback deletion on the target HMC for any created test service codes (`PILOT-TEST-001` through `PILOT-TEST-005`).
3. **Profile Cache Invalidation**: Run `BrowserProfileManager.deleteProfile(clientId, userId)` to clear cached session cookies and local storage.
4. **Audit Incident Logging**: Record a security and operations incident report citing the specific step index, target selector, and DOM snapshot hash.

---

## 4. MFA, OTP & CAPTCHA Manual-Intervention Protocol

- If the target hospital portal issues an unexpected MFA, SMS OTP, or CAPTCHA challenge, the automation engine **strictly halts** execution and marks the run as `REQUIRES_MANUAL_INTERVENTION`.
- **Zero Bypass Attempt Policy**: Under no circumstances will the automation engine attempt to bypass or script around security challenges.
- **Operator Hand-off**: The operator is notified in the Desktop Agent window to manually complete the two-factor authentication challenge before resuming automation.

---

## 5. Data Redaction & Privacy Compliance

- **No Plaintext Credential Display**: Passwords and client credentials must remain masked (`ad***@hospital.org` and `********`) at all times.
- **Log & Screenshot Sanitization**: DOM screenshots taken during error conditions must be stored locally in encrypted profile directories with `0700` permissions and never pushed to Git or external repositories.
- **PHI / PII Protection**: Patient records, patient IDs, and clinical data are out of scope. The pilot is restricted exclusively to the Service Master catalog.

---

## 6. Pilot Sign-Off & Authorization Signatures

| Role | Name | Signature | Date | Decision |
|---|---|---|---|---|
| **Hospital Operations Lead** | ____________________ | ____________________ | ________ | `[ ] APPROVED  [ ] REJECTED` |
| **Lead Security Officer** | ____________________ | ____________________ | ________ | `[ ] APPROVED  [ ] REJECTED` |
| **Central Console Architect** | ____________________ | ____________________ | ________ | `[ ] APPROVED  [ ] REJECTED` |
