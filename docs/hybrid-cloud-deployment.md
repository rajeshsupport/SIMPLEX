# Hybrid-Cloud Deployment Architecture

## 1. Overview

The Central Console supports a hybrid deployment model:
- **Central API & Database**: Deployed in secure cloud or corporate datacenter (e.g. AWS ECS / Azure Container Apps / Kubernetes with Azure SQL or AWS RDS for SQL Server).
- **Desktop Automation Agents**: Deployed on premise within hospital or clinic networks where target HMC web applications are accessible.

```
[ Central Cloud VPC ]
┌─────────────────────────────────────────────────────────┐
│  Kubernetes / ECS Container                             │
│  - NestJS API (apps/api)                                │
│  - React Admin Console (apps/web on CloudFront / S3)    │
│  - Managed MSSQL Database (HMC_CENTRAL_AUTOMATION)     │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTPS TLS 1.3 / WSS
                           ▼
[ On-Premises Clinic / Hospital Network ]
┌─────────────────────────────────────────────────────────┐
│  Desktop Agent Workstation (Electron + Playwright)      │
│  - Persistent Chromium Engine                           │
│  - Direct access to local HMC Portal screens            │
│  - HTTPS / REST dispatch to Central API                 │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Production Docker Deployment

Build and start the containerized backend:

```bash
docker compose -f docker/docker-compose.yml up -d --build
```
