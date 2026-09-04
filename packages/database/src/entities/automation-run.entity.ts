import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Client } from './client.entity.js';
import { DesktopAgent } from './desktop-agent.entity.js';
import { AutomationRunStep } from './automation-run-step.entity.js';

@Entity('automation_runs')
export class AutomationRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uniqueidentifier' })
  clientId!: string;

  @Column({ type: 'uniqueidentifier', nullable: true })
  workflowId?: string | null;

  @Column({ type: 'uniqueidentifier', nullable: true })
  desktopAgentId?: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  triggeredByUserId?: string | null;

  @Column({ type: 'nvarchar', length: 50, default: 'INTERACTIVE_LOGIN' })
  runType!:
    | 'OPEN_INTERACTIVE_CLIENT_SESSION'
    | 'SYNC_CLIENT_USERS_HEADLESS'
    | 'SYNC_CLIENT_USERS'
    | 'INTERACTIVE_LOGIN'
    | 'TEST_LOGIN'
    | 'CREATE_USER'
    | 'CREATE_CLIENT_USER'
    | 'EDIT_CLIENT_USER'
    | 'EDIT_AND_UPDATE_CLIENT'
    | 'SET_CLIENT_USER_STATUS'
    | 'CHANGE_CLIENT_USER_STATUS'
    | 'RESET_CLIENT_USER_PASSWORD'
    | 'RESET_PASSWORD'
    | 'CREATE_SERVICE'
    | 'BULK_IMPORT'
    | 'BULK_IMPORT_CLIENT_USERS'
    | 'INSPECT_CREATE_FORM_METADATA'
    | 'INSPECT_FORM_OPTIONS';

  @Index()
  @Column({ type: 'nvarchar', length: 50, default: 'QUEUED' })
  status!:
    | 'QUEUED'
    | 'CLAIMED'
    | 'AUTHENTICATING'
    | 'NAVIGATING'
    | 'EXTRACTING'
    | 'PERSISTING'
    | 'SUCCEEDED'
    | 'COMPLETED'
    | 'FAILED'
    | 'CANCELLED'
    | 'TIMED_OUT'
    | 'PENDING'
    | 'RUNNING'
    | 'REQUIRES_MANUAL_INTERVENTION';

  @Column({ type: 'datetime2', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'datetime2', nullable: true })
  completedAt?: Date | null;

  @Column({ type: 'int', nullable: true })
  totalDurationMs?: number | null;

  @Index()
  @Column({ type: 'nvarchar', length: 100, nullable: true })
  correlationId?: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  importJobId?: string | null;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  errorMessage?: string | null;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  parametersJson?: string | null;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  resultSummaryJson?: string | null;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime2' })
  updatedAt!: Date;

  @ManyToOne(() => Client, (client) => client.automationRuns, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clientId' })
  client!: Client;

  @ManyToOne(() => DesktopAgent, (agent) => agent.automationRuns, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'desktopAgentId' })
  desktopAgent?: DesktopAgent | null;

  @OneToMany(() => AutomationRunStep, (step) => step.automationRun, { cascade: true })
  steps!: AutomationRunStep[];
}
