import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  OneToOne,
  Index,
} from 'typeorm';
import { UserClientAccess } from './user-client-access.entity.js';
import { ClientCredential } from './client-credential.entity.js';
import { ImportJob } from './import-job.entity.js';
import { AutomationRun } from './automation-run.entity.js';

@Entity('clients')
export class Client {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'nvarchar', length: 50 })
  clientCode!: string;

  @Column({ type: 'nvarchar', length: 150 })
  clientName!: string;

  @Column({ type: 'nvarchar', length: 500 })
  baseUrl!: string;

  @Column({ type: 'nvarchar', length: 255, default: '/hmc' })
  applicationPath!: string;

  @Column({ type: 'nvarchar', length: 50, default: 'Development' })
  environment!: 'Production' | 'Staging' | 'UAT' | 'Test' | 'Development' | 'Local';

  @Column({ type: 'nvarchar', length: 50, default: 'v1.0' })
  applicationVersion!: string;

  @Column({ type: 'nvarchar', length: 255, default: '/login' })
  loginRoute!: string;

  @Column({ type: 'nvarchar', length: 255, default: '/hmc/users' })
  usersRoute!: string;

  @Column({ type: 'nvarchar', length: 255, default: '/hmc/services' })
  servicesRoute!: string;

  @Column({ type: 'nvarchar', length: 255, default: '/addUserRole', nullable: true })
  userRoleRoute?: string | null;

  @Column({ type: 'nvarchar', length: 255, default: '/addResourceParentDetails', nullable: true })
  quickResourceRoute?: string | null;

  @Column({ type: 'nvarchar', length: 255, default: '/addParentResourceUser', nullable: true })
  resourceUserRoute?: string | null;

  @Column({ type: 'nvarchar', length: 255, default: null, nullable: true })
  resourceDirectoryRoute?: string | null;

  @Column({ type: 'nvarchar', length: 50, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

  @Column({ type: 'nvarchar', length: 50, default: 'UNKNOWN' })
  connectionStatus!: 'CONNECTED' | 'DISCONNECTED' | 'UNKNOWN' | 'ERROR';

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  allowedDesktopAgentsJson?: string | null;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  createdBy?: string;

  @UpdateDateColumn({ type: 'datetime2' })
  updatedAt!: Date;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  updatedBy?: string;

  @OneToOne(() => ClientCredential, (cred) => cred.client, { cascade: true })
  credential?: ClientCredential;

  @OneToMany(() => UserClientAccess, (uca) => uca.client)
  userAccesses!: UserClientAccess[];

  @OneToMany(() => ImportJob, (job) => job.client)
  importJobs!: ImportJob[];

  @OneToMany(() => AutomationRun, (run) => run.client)
  automationRuns!: AutomationRun[];
}
