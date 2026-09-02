import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @CreateDateColumn({ type: 'datetime2' })
  timestamp!: Date;

  @Index()
  @Column({ type: 'nvarchar', length: 100, nullable: true })
  actorUserId?: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  actorUsername?: string | null;

  @Index()
  @Column({ type: 'nvarchar', length: 100, nullable: true })
  clientId?: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  clientCode?: string | null;

  @Index()
  @Column({ type: 'nvarchar', length: 100 })
  action!: string;

  @Column({ type: 'nvarchar', length: 100 })
  entityType!: string;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  entityId?: string | null;

  @Index()
  @Column({ type: 'nvarchar', length: 50, default: 'SUCCESS' })
  result!: 'SUCCESS' | 'FAILURE' | 'DENIED' | 'SECURITY_BLOCK';

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  ipAddress?: string | null;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  userAgent?: string | null;

  @Index()
  @Column({ type: 'nvarchar', length: 100, nullable: true })
  correlationId?: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  importJobId?: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  automationRunId?: string | null;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  detailsJson?: string | null;
}
