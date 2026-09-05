import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ResourceImportJob } from './resource-import-job.entity.js';
import { ResourceImportStage } from '@hmc/shared';

@Entity('resource_import_rows')
@Index('IDX_res_row_job', ['jobId', 'rowNumber'])
@Index('IDX_res_row_stage', ['jobId', 'stage'])
export class ResourceImportRow {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uniqueidentifier' })
  jobId!: string;

  @Column({ type: 'int' })
  rowNumber!: number;

  @Column({ type: 'nvarchar', length: 250 })
  resourceName!: string;

  @Column({ type: 'bit', default: 1 })
  isResourceHuman!: boolean;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  remoteResourceId?: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  remoteUserId?: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  username?: string | null;

  @Column({ type: 'nvarchar', length: 50, default: ResourceImportStage.NOT_STARTED })
  stage!: ResourceImportStage;

  @Column({ type: 'nvarchar', length: 50, default: 'PENDING' })
  status!: 'PENDING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  retryStartingPoint?: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  safeErrorCode?: string | null;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  safeErrorMessage?: string | null;

  @Column({ type: 'nvarchar', length: 'max', nullable: true })
  rawRowJson?: string | null;

  @ManyToOne(() => ResourceImportJob, (j) => j.rows, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobId' })
  job!: ResourceImportJob;
}
