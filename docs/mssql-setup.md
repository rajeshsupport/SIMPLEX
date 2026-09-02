# Microsoft SQL Server Configuration & Migration Guide

## 1. Database Configuration

The application requires Microsoft SQL Server 2022. Connection parameters are read strictly from environment variables:

| Environment Variable | Description | Default Dev Value |
|---|---|---|
| `MSSQL_HOST` | Hostname or IP of SQL Server | `localhost` |
| `MSSQL_PORT` | Port number | `1433` |
| `MSSQL_DATABASE` | Central automation database name | `HMC_CENTRAL_AUTOMATION` |
| `MSSQL_USER` | Database login user | `sa` |
| `MSSQL_PASSWORD` | Database password | `Rajesh@123` |
| `MSSQL_ENCRYPT` | Enable TLS encryption | `false` (dev) / `true` (prod) |
| `MSSQL_TRUST_SERVER_CERTIFICATE` | Trust self-signed certificates | `true` (dev) / `false` (prod) |

---

## 2. Docker Setup for Local SQL Server

A pre-configured `docker-compose.yml` is provided under `docker/`:

```bash
docker compose -f docker/docker-compose.yml up -d mssql
```

---

## 3. Migration Policy

- **No Synchronize in Production**: `synchronize: false` is strictly enforced.
- **Versioned Migrations**: All schema modifications are committed as versioned TypeScript migration classes under `packages/database/src/migrations/`.
- Run migrations:
  ```bash
  pnpm --filter @hmc/database migration:run
  ```

---

## 4. Disaster Recovery & Backup

- **Full Database Backup**:
  ```sql
  BACKUP DATABASE HMC_CENTRAL_AUTOMATION
  TO DISK = '/var/opt/mssql/backup/HMC_CENTRAL_AUTOMATION_Full.bak'
  WITH FORMAT, MEDIANAME = 'HMC_Backup', NAME = 'Full Backup of HMC_CENTRAL_AUTOMATION';
  ```
- **Database Restore**:
  ```sql
  RESTORE DATABASE HMC_CENTRAL_AUTOMATION
  FROM DISK = '/var/opt/mssql/backup/HMC_CENTRAL_AUTOMATION_Full.bak'
  WITH REPLACE;
  ```
