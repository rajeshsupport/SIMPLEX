import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { AutomationWorkflowVersion } from './automation-workflow-version.entity.js';

@Entity('automation_workflows')
export class AutomationWorkflow {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'nvarchar', length: 100 })
  workflowCode!: string;

  @Column({ type: 'nvarchar', length: 150 })
  name!: string;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  description?: string;

  @Column({ type: 'nvarchar', length: 50, default: 'v1.0' })
  appVersion!: string;

  @CreateDateColumn({ type: 'datetime2' })
  createdAt!: Date;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  createdBy?: string;

  @UpdateDateColumn({ type: 'datetime2' })
  updatedAt!: Date;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  updatedBy?: string;

  @OneToMany(() => AutomationWorkflowVersion, (version) => version.workflow, { cascade: true })
  versions!: AutomationWorkflowVersion[];
}
