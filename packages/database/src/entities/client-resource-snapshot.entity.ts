import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { ClientResourceDepartment } from './client-resource-department.entity.js';
import { ClientResourceService } from './client-resource-service.entity.js';

@Entity('client_resource_snapshots')
@Index('IDX_client_resource_remote_id', ['clientId', 'remoteResourceId'], { unique: true })
export class ClientResourceSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uniqueidentifier' })
  clientId!: string;

  @Column({ type: 'nvarchar', length: 50 })
  clientCode!: string;

  @Column({ type: 'nvarchar', length: 100 })
  remoteResourceId!: string;

  @Column({ type: 'nvarchar', length: 100 })
  resourceCode!: string;

  @Column({ type: 'nvarchar', length: 250 })
  resourceName!: string;

  @Column({ type: 'bit', default: 1 })
  isResourceHuman!: boolean;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  remoteResourceTypeId?: string | null;

  @Column({ type: 'nvarchar', length: 150, nullable: true })
  resourceTypeName?: string | null;

  @Column({ type: 'nvarchar', length: 50, nullable: true })
  resourceType?: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  remoteSpecialtyId?: string | null;

  @Column({ type: 'nvarchar', length: 150, nullable: true })
  specialtyName?: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  department?: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  specialization?: string | null;

  @Column({ type: 'nvarchar', length: 10, default: 'FFFFFF' })
  colorIdentificationCode!: string;

  @Column({ type: 'nvarchar', length: 10, default: '00:00' })
  operatingFrom!: string;

  @Column({ type: 'nvarchar', length: 10, default: '23:55' })
  operatingTo!: string;

  @Column({ type: 'bit', default: 1 })
  selectAllDepartments!: boolean;

  @Column({ type: 'bit', default: 1 })
  selectAllServices!: boolean;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  linkedRemoteUserId?: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  linkedUsername?: string | null;

  @Column({ type: 'bit', default: 1 })
  isShownInRegistration!: boolean;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  branchId?: string | null;

  @Column({ type: 'nvarchar', length: 150, nullable: true })
  branchName?: string | null;

  @Column({ type: 'nvarchar', length: 50, default: 'ACTIVE' })
  remoteStatus!: string;

  @Column({ type: 'nvarchar', length: 50, default: 'ACTIVE' })
  status!: string;

  @Column({ type: 'bit', default: 1 })
  isPresentRemotely!: boolean;

  @Column({ type: 'datetime2', default: () => 'SYSUTCDATETIME()' })
  lastVerifiedAt!: Date;

  @Column({ type: 'datetime2', default: () => 'SYSUTCDATETIME()' })
  lastSyncedAt!: Date;

  @Column({ type: 'nvarchar', length: 50, nullable: true })
  workflowStage?: string | null;

  @Column({ type: 'nvarchar', length: 50, nullable: true })
  eclaimStatus?: string | null;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  eclaimConfigJson?: string | null;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  emrFormsJson?: string | null;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  transferConfigJson?: string | null;

  @Column({ type: 'nvarchar', length: 50, nullable: true })
  retryResumeState?: string | null;


  @OneToMany(() => ClientResourceDepartment, (d) => d.resource, { cascade: true })
  departments!: ClientResourceDepartment[];

  @OneToMany(() => ClientResourceService, (s) => s.resource, { cascade: true })
  services!: ClientResourceService[];

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime2' })
  updatedAt!: Date;
}
