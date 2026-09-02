# User Acceptance Testing (UAT) Checklist

## 1. Authentication & Security
- [ ] Sign in with bootstrapped Super Admin credentials created via `pnpm admin:bootstrap`.
- [ ] Attempt sign-in with wrong password 5 times; confirm 15-minute account lockout.
- [ ] Change current password via profile modal; verify old password is invalidated.
- [ ] Verify JWT refresh token rotates automatically upon access token expiration.

## 2. RBAC & Client Boundaries
- [ ] Create a custom user assigned with `URL Operator` role and assigned only to `Client A`.
- [ ] Log in as `URL Operator`; confirm inability to view or edit unassigned `Client B`.
- [ ] Confirm attempt to create a client returns HTTP 403 Forbidden.

## 3. Client Management & Credential Protection
- [ ] Create a new Client configuration (`HMC_TEST_01`, environment `Test`).
- [ ] Add encrypted operator credentials; confirm username is masked (`hm***`) in UI and logs.
- [ ] Execute "Test Connection" against client; verify latency and connectivity feedback.
- [ ] Confirm `Production` client shows a prominent red warning badge.

## 4. Browser Automation & Interactive Open & Login
- [ ] Start mock HMC fixture server (`pnpm dev:fixture`).
- [ ] Click "Open & Login" on target client in console.
- [ ] Confirm Chromium window opens, navigates to `/hmc/login`, enters credentials, and lands on `/hmc/dashboard`.
- [ ] Verify browser window stays open for operator interactive use.

## 5. Spreadsheet Batch Import Wizard
- [ ] Upload sample Service Master spreadsheet (.xlsx/.csv).
- [ ] Review auto-mapping and preview validation status.
- [ ] Test 1-record test dry run mode.
- [ ] Target Production client; verify typed confirmation is strictly enforced.
- [ ] Trigger execution, pause midway, resume, and export error CSV of any invalid rows.

## 6. Audit Trail & Retention
- [ ] Inspect Audit Log viewer; verify every login, client change, and import event is recorded.
- [ ] Export Audit Trail to CSV.
- [ ] Trigger manual retention purge; confirm purge summary response.
