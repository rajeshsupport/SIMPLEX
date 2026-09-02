import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { AutomationWorkflow } from './automation-workflow.entity.js';

@Entity('automation_workflow_versions')
@Index(['workflowId', 'versionNumber'], { unique: true })
export class AutomationWorkflowVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uniqueidentifier' })
  workflowId!: string;

  @Column({ type: 'int', default: 1 })
  versionNumber!: number;

  @Column({ type: 'nvarchar', length: 50, default: 'v1.0' })
  applicableAppVersion!: string;

  @Column({ type: 'nvarchar', length: 255 })
  pageRoute!: string;

  @Column({ type: 'nvarchar', length: 'max' })
  stepsJson!: string;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  selectorsJson?: string | null;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  successConditionsJson?: string | null;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  errorConditionsJson?: string | null;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  securityBlockConditionsJson?: string | null;

  @Column({ type: 'int', default: 30000 })
  defaultTimeoutMs!: number;

  @Column({ type: 'int', default: 2 })
  maxRetries!: number;

  @Column({ type: 'bit', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  createdBy?: string;

  @ManyToOne(() => AutomationWorkflow, (workflow) => workflow.versions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflowId' })
  workflow!: AutomationWorkflow;
}
