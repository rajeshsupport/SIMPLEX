# Roles, Permissions & RBAC Specifications

## 1. System Roles

| Role Name | Description | Default Scope |
|---|---|---|
| **Super Admin** | Unrestricted root administrator | Universal access to all actions and clients |
| **Admin** | Full administrator excluding master key deletion | All operations across managed clients |
| **User Administrator** | Specialist in client user lifecycle | User creation, password resets |
| **Import Operator** | Specialist in spreadsheet uploads | Uploads, previews, job executions, error reviews |
| **URL Operator** | Operator for browser verification | Open & Login, connection testing |
| **Auditor** | Read-only compliance auditor | Audit logs, execution history, exports |
| **Viewer** | Read-only general observer | Dashboard and client view |

---

## 2. Permission Codes

- `dashboard.view`
- `client.view`, `client.create`, `client.update`, `client.disable`, `client.open`, `client.test_login`
- `credential.manage`
- `user_management.view`, `user_management.create`, `user_management.reset_password`
- `service_master.view`, `service_master.import`
- `import.preview`, `import.execute`, `import.pause`, `import.resume`, `import.retry_failed`, `import.cancel`, `import.export_errors`
- `audit.view`, `audit.export`
- `role.view`, `role.manage`
- `application_user.manage`
- `workflow.view`, `workflow.manage`
- `agent.view`, `agent.manage`
