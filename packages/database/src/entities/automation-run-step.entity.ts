import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { AutomationRun } from './automation-run.entity.js';

@Entity('automation_run_steps')
@Index(['automationRunId', 'stepIndex'])
export class AutomationRunStep {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uniqueidentifier' })
  automationRunId!: string;

  @Column({ type: 'int' })
  stepIndex!: number;

  @Column({ type: 'nvarchar', length: 150 })
  stepName!: string;

  @Column({ type: 'nvarchar', length: 50, default: 'PENDING' })
  status!: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';

  @Column({ type: 'datetime2', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'datetime2', nullable: true })
  completedAt?: Date | null;

  @Column({ type: 'int', nullable: true })
  durationMs?: number | null;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  errorMessage?: string | null;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  screenshotFilePath?: string | null;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  stepDetailsJson?: string | null;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @ManyToOne(() => AutomationRun, (run) => run.steps, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'automationRunId' })
  automationRun!: AutomationRun;
}
