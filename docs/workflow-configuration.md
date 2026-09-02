# Automation Workflow & Selector Configuration

## 1. Workflow Schema

All browser interactions are driven by JSON-defined, versioned workflows stored in MSSQL (`automation_workflows` & `automation_workflow_versions`). Adding support for a new client application version requires no code compilation—only a new workflow version entry.

### Example Workflow JSON Structure

```json
{
  "workflowCode": "HMC_LOGIN",
  "name": "HMC Automated Login Workflow",
  "appVersion": "v1.0",
  "pageRoute": "/hmc/login",
  "steps": [
    {
      "stepIndex": 1,
      "stepName": "Navigate to Login Page",
      "action": "NAVIGATE",
      "valueTemplate": "{{loginUrl}}",
      "timeoutMs": 15000
    },
    {
      "stepIndex": 2,
      "stepName": "Enter Username",
      "action": "FILL",
      "targetSelector": {
        "strategy": "TEST_ID",
        "value": "input-username",
        "fallbackSelectors": [
          { "strategy": "ID", "value": "username" },
          { "strategy": "NAME", "value": "username" }
        ]
      },
      "valueTemplate": "{{username}}"
    },
    {
      "stepIndex": 3,
      "stepName": "Enter Password",
      "action": "FILL",
      "targetSelector": {
        "strategy": "TEST_ID",
        "value": "input-password",
        "fallbackSelectors": [
          { "strategy": "ID", "value": "password" }
        ]
      },
      "valueTemplate": "{{password}}"
    },
    {
      "stepIndex": 4,
      "stepName": "Click Sign In",
      "action": "CLICK",
      "targetSelector": {
        "strategy": "TEST_ID",
        "value": "btn-login"
      }
    }
  ],
  "successConditions": [
    { "type": "URL_CONTAINS", "expectedValue": "/hmc/dashboard", "isTerminalSuccess": true }
  ],
  "securityBlockConditions": [
    { "type": "ELEMENT_VISIBLE", "selector": { "strategy": "TEST_ID", "value": "mfa-challenge" }, "isSecurityControlBlock": true }
  ]
}
```
