# Spreadsheet Import & Resilient Processing Guide

## 1. Import Workflow Lifecycle

Because browser automation cannot provide traditional database transactions, imports use **checkpoint-based persistence** and **idempotency tracking**:

```
[ Upload .xlsx / .csv ]
          │
          ▼
[ Zod Validation & In-File Duplicate Check ]
          │
          ▼
[ Preview (Valid vs Invalid Rows Summary) ]
          │
          ▼
[ Target Client Confirmation (Typed Confirmation for Prod) ]
          │
          ▼
[ Create Import Job & Insert Rows (Status: PENDING) ]
          │
          ▼
[ Row-by-Row Playwright Processing & Checkpointing ]
    ├── Success  ──> Row marked SUCCEEDED
    ├── Error    ──> Row marked FAILED (Capture screenshot & message)
    └── Security ──> Job PAUSED (REQUIRES_MANUAL_INTERVENTION)
          │
          ▼
[ Failed-Row Only Retry & Downloadable Error Report CSV ]
```

---

## 2. Supported Formats

- `.xlsx` / `.xls` (Microsoft Excel workbooks)
- `.csv` (Comma-separated values)

---

## 3. Production Safety Guardrails

- **Typed Confirmation**: Imports targeting `Production` clients require the operator to manually type the client code (e.g. `HMC_MAIN_PROD`) before job authorization.
- **One-Record Test Mode**: Operators can run a single dry-run record against the client before committing the entire spreadsheet.
- **Retry Failed Rows Only**: Rows that previously succeeded are never re-run, eliminating duplicate entries in target client databases.
